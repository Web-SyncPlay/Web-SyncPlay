/**
 * Local-media Range SW (built to public/local-media-sw.js).
 * Intercepts /api/media/local/* and prefers SFU → P2P before HTTP relay.
 * Open-ended ranges default to LOCAL_MEDIA_MAX_BLOCK_BYTES (256KiB).
 * Network fallback adds `?vt=` / `uid=` from the requesting client when missing.
 *
 * Viewer capability is keyed by Client.id so host + guest tabs on the same
 * origin do not overwrite each other's tokens.
 *
 * Until the page posts `local-media-sw-bridge-ready`, Range requests pass
 * straight to HTTP (no client round-trip). That avoids multi-second stalls and
 * opaque SW errors when the bridge is not listening yet.
 */
import { LOCAL_MEDIA_MAX_BLOCK_BYTES } from "../shared/local-media/local-media-block-protocol"
import { parseRawBytesRangeHeader } from "../shared/local-media/local-media-range"
import {
  LOCAL_MEDIA_VIEWER_TOKEN_PARAM,
  LOCAL_MEDIA_VIEWER_USER_PARAM,
} from "../shared/local-media/local-media-viewer-token"

/** How long to wait for in-page SFU/P2P before HTTP relay (ms). */
const RANGE_CLIENT_TIMEOUT_MS = 1_500

const sw = self as unknown as {
  skipWaiting: () => Promise<void>
  clients: {
    claim: () => Promise<void>
    get: (id: string) => Promise<{
      id?: string
      postMessage: (msg: unknown, transfer?: Transferable[]) => void
    } | null>
  }
  addEventListener: (
    type: string,
    listener: (event: {
      waitUntil?: (p: Promise<unknown>) => void
      request?: Request
      clientId?: string
      respondWith?: (r: Promise<Response> | Response) => void
      data?: unknown
      source?: { id?: string } | null
    }) => void,
  ) => void
}

type RangeResult = {
  buffer: ArrayBuffer
  mimeType?: string
  totalSize?: number
  source: "sfu" | "webrtc" | "local"
}

type ViewerCapabilitySwRecord = {
  token: string
  userId: string
}

/** Per controlling Client — host and guest windows must not share one token. */
const viewerCapabilityByClientId = new Map<string, ViewerCapabilitySwRecord>()
/** Clients that have attached the in-page SFU/P2P bridge. */
const bridgeReadyClientIds = new Set<string>()

sw.addEventListener("install", (event) => {
  event.waitUntil?.(sw.skipWaiting())
})

sw.addEventListener("activate", (event) => {
  event.waitUntil?.(sw.clients.claim())
})

sw.addEventListener("message", (event) => {
  const data = event.data as {
    type?: string
    record?: { token?: string; userId?: string } | null
  } | null
  if (!data?.type) return
  const clientId = event.source?.id
  if (!clientId) return

  if (data.type === "local-media-sw-bridge-ready") {
    bridgeReadyClientIds.add(clientId)
    return
  }

  if (data.type !== "local-media-sw-viewer-capability") return
  const token = data.record?.token?.trim()
  const userId = data.record?.userId?.trim()
  if (token && userId) {
    viewerCapabilityByClientId.set(clientId, { token, userId })
  } else {
    viewerCapabilityByClientId.delete(clientId)
  }
})

/**
 * Rebuild a same-origin GET from the URL string. Never reuse the FetchEvent
 * Request — Firefox rejects respondWith when that body/stream is disturbed.
 */
function networkFetch(
  request: Request,
  clientId: string | undefined,
): Promise<Response> {
  const url = new URL(request.url)
  if (
    url.pathname.startsWith("/api/media/local/") &&
    !url.pathname.includes("/internal/")
  ) {
    const capability = clientId
      ? viewerCapabilityByClientId.get(clientId)
      : undefined
    if (
      capability &&
      (!url.searchParams.has(LOCAL_MEDIA_VIEWER_TOKEN_PARAM) ||
        !url.searchParams.has(LOCAL_MEDIA_VIEWER_USER_PARAM))
    ) {
      url.searchParams.set(LOCAL_MEDIA_VIEWER_TOKEN_PARAM, capability.token)
      url.searchParams.set(LOCAL_MEDIA_VIEWER_USER_PARAM, capability.userId)
    }
  }

  const headers = new Headers()
  const range = request.headers.get("range")
  if (range) headers.set("Range", range)
  const accept = request.headers.get("accept")
  if (accept) headers.set("Accept", accept)

  return fetch(url.toString(), {
    method: "GET",
    headers,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "follow",
  })
}

async function askClientForRange(
  client: { postMessage: (msg: unknown, transfer?: Transferable[]) => void },
  mediaId: string,
  start: number,
  end: number,
): Promise<RangeResult | null> {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => {
      resolve(null)
    }, RANGE_CLIENT_TIMEOUT_MS)
    channel.port1.onmessage = (event) => {
      clearTimeout(timer)
      const data = event.data as {
        requestId?: string
        ok?: boolean
        buffer?: ArrayBuffer
        mimeType?: string
        totalSize?: number
        source?: string
      } | null
      if (!data || data.requestId !== requestId) {
        resolve(null)
        return
      }
      if (!data.ok || !data.buffer) {
        resolve(null)
        return
      }
      const source =
        data.source === "webrtc"
          ? "webrtc"
          : data.source === "local"
            ? "local"
            : "sfu"
      resolve({
        buffer: data.buffer,
        mimeType:
          typeof data.mimeType === "string" && data.mimeType
            ? data.mimeType
            : undefined,
        totalSize:
          typeof data.totalSize === "number" && data.totalSize > 0
            ? data.totalSize
            : undefined,
        source,
      })
    }
    try {
      client.postMessage(
        {
          type: "local-media-sw-range",
          requestId,
          mediaId,
          start,
          end,
        },
        [channel.port2],
      )
    } catch {
      clearTimeout(timer)
      resolve(null)
    }
  })
}

function rangeResponse(result: RangeResult, rangeStart: number): Response {
  const bytes = new Uint8Array(result.buffer)
  const total = result.totalSize != null ? result.totalSize : "*"
  return new Response(bytes, {
    status: 206,
    headers: {
      "Content-Type": result.mimeType || "application/octet-stream",
      "Accept-Ranges": "bytes",
      "Content-Length": String(bytes.byteLength),
      "Content-Range": `bytes ${rangeStart}-${rangeStart + bytes.byteLength - 1}/${total}`,
      "Cache-Control": "private, max-age=15",
      "X-Local-Media-Source": result.source,
    },
  })
}

sw.addEventListener("fetch", (event) => {
  if (!event.request || !event.respondWith) return
  const url = new URL(event.request.url)
  if (!url.pathname.startsWith("/api/media/local/")) return
  if (url.pathname.includes("/internal/")) return
  if (url.pathname.includes("/hls/")) return

  const parts = url.pathname.split("/").filter(Boolean)
  // api media local {id}
  const mediaId = parts[3]
  if (!mediaId) return

  const request = event.request
  const clientId = event.clientId
  event.respondWith(
    (async (): Promise<Response> => {
      try {
        const range = parseRawBytesRangeHeader(request.headers.get("range"))
        if (!range) {
          return await networkFetch(request, clientId)
        }

        // Bridge not ready → HTTP immediately (guest join / cold SW).
        if (!clientId || !bridgeReadyClientIds.has(clientId)) {
          return await networkFetch(request, clientId)
        }

        const end = range.end ?? range.start + LOCAL_MEDIA_MAX_BLOCK_BYTES - 1
        let client: {
          postMessage: (msg: unknown, transfer?: Transferable[]) => void
        } | null = null
        try {
          client = await sw.clients.get(clientId)
        } catch {
          client = null
        }
        if (client) {
          const result = await askClientForRange(
            client,
            mediaId,
            range.start,
            end,
          )
          if (result) {
            return rangeResponse(result, range.start)
          }
        }

        return await networkFetch(request, clientId)
      } catch {
        try {
          return await networkFetch(request, clientId)
        } catch {
          return new Response("local-media service worker error", {
            status: 502,
            headers: { "Content-Type": "text/plain" },
          })
        }
      }
    })(),
  )
})
