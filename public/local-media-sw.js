/* eslint-disable no-restricted-globals */
/**
 * Intercepts /api/media/local/* Range requests and asks the page for
 * WebRTC-delivered bytes before falling back to network (HTTP relay).
 */
const CHANNEL = "web-syncplay-local-media-sw"

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

function parseRange(header) {
  if (!header) return null
  const match = /^bytes=(\d+)-(\d+)?$/i.exec(header.trim())
  if (!match) return null
  const start = Number.parseInt(match[1], 10)
  const end = match[2] != null ? Number.parseInt(match[2], 10) : null
  if (!Number.isFinite(start)) return null
  return { start, end }
}

async function askClientForRange(client, mediaId, start, end) {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => {
      resolve(null)
    }, 12_000)
    channel.port1.onmessage = (event) => {
      clearTimeout(timer)
      const data = event.data
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

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)
  if (!url.pathname.startsWith("/api/media/local/")) return
  if (url.pathname.includes("/internal/")) return
  if (url.pathname.includes("/hls/")) return

  const parts = url.pathname.split("/").filter(Boolean)
  // api media local {id}
  const mediaId = parts[3]
  if (!mediaId) return

  event.respondWith(
    (async () => {
      const range = parseRange(event.request.headers.get("range"))
      if (!range) {
        return fetch(event.request)
      }

      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      const end = range.end ?? range.start + 256 * 1024 - 1
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
      return fetch(event.request)
    })(),
  )
})
