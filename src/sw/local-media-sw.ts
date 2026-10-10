/**
 * Service Worker source of truth for local-media Range interception.
 * Built to public/local-media-sw.js via scripts/build-local-media-sw.ts.
 *
 * Intercepts /api/media/local/* Range requests and asks the page for
 * bytes via SFU → P2P before falling back to network (HTTP relay).
 * Default open-ended range length matches LOCAL_MEDIA_MAX_BLOCK_BYTES (256KiB).
 *
 * Viewer capability (`?vt=` / `uid=`): page posts the active token; network
 * fallback fetches are decorated when the request URL lacks them.
 */
import { LOCAL_MEDIA_MAX_BLOCK_BYTES } from "../shared/local-media/local-media-block-protocol"
import { parseRawBytesRangeHeader } from "../shared/local-media/local-media-range"
import {
  LOCAL_MEDIA_VIEWER_TOKEN_PARAM,
  LOCAL_MEDIA_VIEWER_USER_PARAM,
} from "../shared/local-media/local-media-viewer-token"

/* eslint-disable no-restricted-globals -- Service Worker global scope */
const sw = self as unknown as {
  skipWaiting: () => Promise<void>
  clients: {
    claim: () => Promise<void>
    matchAll: (opts: {
      type: string
      includeUncontrolled: boolean
    }) => Promise<Array<{ postMessage: (msg: unknown, transfer?: Transferable[]) => void }>>
  }
  addEventListener: (
    type: string,
    listener: (event: {
      waitUntil?: (p: Promise<unknown>) => void
      request?: Request
      respondWith?: (r: Promise<Response> | Response) => void
      data?: unknown
    }) => void,
  ) => void
}

type RangeResult = {
  buffer: ArrayBuffer
  mimeType?: string
  totalSize?: number
  source: "sfu" | "webrtc"
}

type ViewerCapabilitySwRecord = {
  token: string
  userId: string
}

let viewerCapability: ViewerCapabilitySwRecord | null = null

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
  if (!data || data.type !== "local-media-sw-viewer-capability") return
  const token = data.record?.token?.trim()
  const userId = data.record?.userId?.trim()
  viewerCapability =
    token && userId ? { token, userId } : null
})

/** Ensure `vt` / `uid` are present on local-media HTTP fallback URLs. */
function withViewerCapabilityOnRequest(request: Request): Request {
  if (!viewerCapability) return request
  try {
    const url = new URL(request.url)
    if (!url.pathname.startsWith("/api/media/local/")) return request
    if (url.pathname.includes("/internal/")) return request
    if (
      url.searchParams.has(LOCAL_MEDIA_VIEWER_TOKEN_PARAM) &&
      url.searchParams.has(LOCAL_MEDIA_VIEWER_USER_PARAM)
    ) {
      return request
    }
    url.searchParams.set(LOCAL_MEDIA_VIEWER_TOKEN_PARAM, viewerCapability.token)
    url.searchParams.set(LOCAL_MEDIA_VIEWER_USER_PARAM, viewerCapability.userId)
    return new Request(url.toString(), request)
  } catch {
    return request
  }
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
    }, 12_000)
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
        source: data.source === "webrtc" ? "webrtc" : "sfu",
      })
    }
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
  event.respondWith(
    (async () => {
      const range = parseRawBytesRangeHeader(
        request.headers.get("range"),
      )
      if (!range) {
        return fetch(withViewerCapabilityOnRequest(request))
      }

      const clients = await sw.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      const end = range.end ?? range.start + LOCAL_MEDIA_MAX_BLOCK_BYTES - 1
      for (const client of clients) {
        const result = await askClientForRange(
          client,
          mediaId,
          range.start,
          end,
        )
        if (result) {
          const bytes = new Uint8Array(result.buffer)
          const total = result.totalSize != null ? result.totalSize : "*"
          return new Response(bytes, {
            status: 206,
            headers: {
              "Content-Type": result.mimeType || "application/octet-stream",
              "Accept-Ranges": "bytes",
              "Content-Length": String(bytes.byteLength),
              "Content-Range": `bytes ${range.start}-${range.start + bytes.byteLength - 1}/${total}`,
              "Cache-Control": "private, max-age=15",
              "X-Local-Media-Source": result.source,
            },
          })
        }
      }
      return fetch(withViewerCapabilityOnRequest(request))
    })(),
  )
})
