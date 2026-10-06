"use client"

/** Register the local-media Service Worker that prefers WebRTC ranges. */
export async function registerLocalMediaServiceWorker(): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return
  }
  try {
    await navigator.serviceWorker.register("/local-media-sw.js", {
      scope: "/",
    })
  } catch (error) {
    console.warn("[local-media] service worker register failed", error)
  }
}

/**
 * Bridge SW range requests to the in-page mediasoup SFU, then WebRTC mesh.
 * Call once per room session from the socket hook.
 */
export function attachLocalMediaServiceWorkerBridge(input: {
  resolveProviderUserId: (localMediaId: string) => string | null
  resolveMediaMeta: (
    localMediaId: string,
  ) => { mimeType: string; sizeBytes: number } | null
}): () => void {
  if (typeof window === "undefined" || !navigator.serviceWorker) {
    return () => {}
  }

  const onMessage = (event: MessageEvent) => {
    const data = event.data as {
      type?: string
      requestId?: string
      mediaId?: string
      start?: number
      end?: number
    } | null
    if (!data || data.type !== "local-media-sw-range") return
    const port = event.ports[0]
    if (!port || !data.requestId || !data.mediaId) return

    void (async () => {
      try {
        const start = data.start ?? 0
        const end = data.end ?? start + 256 * 1024 - 1

        // Prefer a warm SFU viewer, then P2P mesh; failing both lets the SW
        // fall back to HTTP. A cold SFU viewer is warmed in the background and
        // never awaited here.
        let bytes: Uint8Array | null = null
        let source: "sfu" | "webrtc" = "sfu"
        try {
          const {
            fetchLocalMediaRangeViaSfu,
            isLocalMediaSfuViewerReady,
            warmLocalMediaSfuViewer,
          } = await import("@/lib/local-media-sfu")
          if (isLocalMediaSfuViewerReady(data.mediaId!)) {
            bytes = await fetchLocalMediaRangeViaSfu(
              data.mediaId!,
              start,
              end,
              5000,
            )
          } else {
            warmLocalMediaSfuViewer(data.mediaId!)
          }
        } catch (error) {
          console.warn("[local-media] sfu range fetch failed", error)
        }

        if (!bytes) {
          source = "webrtc"
          const providerUserId = input.resolveProviderUserId(data.mediaId!)
          if (providerUserId) {
            const { fetchLocalMediaRangeViaWebrtc } = await import(
              "@/lib/local-media-webrtc"
            )
            bytes = await fetchLocalMediaRangeViaWebrtc({
              localMediaId: data.mediaId!,
              providerUserId,
              start,
              end,
            })
          }
        }
        if (!bytes) {
          port.postMessage({ requestId: data.requestId, ok: false })
          return
        }
        const meta = input.resolveMediaMeta(data.mediaId!)
        port.postMessage(
          {
            requestId: data.requestId,
            ok: true,
            buffer: bytes.buffer,
            mimeType: meta?.mimeType,
            totalSize: meta?.sizeBytes,
            source,
          },
          [bytes.buffer],
        )
      } catch {
        port.postMessage({ requestId: data.requestId, ok: false })
      }
    })()
  }

  navigator.serviceWorker.addEventListener("message", onMessage)
  return () => {
    navigator.serviceWorker.removeEventListener("message", onMessage)
  }
}
