"use client"

import { LOCAL_MEDIA_MAX_BLOCK_BYTES } from "@/lib/local-media-block-protocol"
import {
  nextDeliveryModeAfterFailure,
  pickFirstReadyDeliveryMode,
  planLocalMediaDeliveryAttempts,
  type LocalMediaDeliveryMode,
} from "@/lib/local-media-sfu-transitions"

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
 * Delivery order: SFU → P2P → (SW falls back to HTTP). Call once per room
 * session from the socket hook.
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
        const end = data.end ?? start + LOCAL_MEDIA_MAX_BLOCK_BYTES - 1
        const mediaId = data.mediaId!
        const providerUserId = input.resolveProviderUserId(mediaId)

        // Prefer a warm SFU viewer, then P2P mesh; failing both lets the SW
        // fall back to HTTP. A cold SFU viewer is warmed in the background and
        // never awaited here.
        let bytes: Uint8Array | null = null
        let source: "sfu" | "webrtc" = "sfu"
        const {
          fetchLocalMediaRangeViaSfu,
          isLocalMediaSfuViewerReady,
          warmLocalMediaSfuViewer,
        } = await import("@/lib/local-media-sfu")
        const attempts = planLocalMediaDeliveryAttempts({
          sfuAvailable: true,
          sfuViewerReady: isLocalMediaSfuViewerReady(mediaId),
          providerUserId,
        })
        if (attempts.some((a) => a.mode === "sfu" && !a.ready)) {
          warmLocalMediaSfuViewer(mediaId)
        }

        let mode: LocalMediaDeliveryMode | null =
          pickFirstReadyDeliveryMode(attempts)
        while (mode === "sfu" || mode === "p2p") {
          try {
            if (mode === "sfu") {
              source = "sfu"
              bytes = await fetchLocalMediaRangeViaSfu(
                mediaId,
                start,
                end,
                5000,
              )
            } else {
              source = "webrtc"
              const { fetchLocalMediaRangeViaWebrtc } = await import(
                "@/lib/local-media-webrtc"
              )
              bytes = await fetchLocalMediaRangeViaWebrtc({
                localMediaId: mediaId,
                providerUserId: providerUserId!,
                start,
                end,
              })
            }
          } catch (error) {
            console.warn(`[local-media] ${mode} range fetch failed`, error)
            bytes = null
          }
          if (bytes) break
          mode = nextDeliveryModeAfterFailure(attempts, mode)
        }

        if (!bytes) {
          port.postMessage({ requestId: data.requestId, ok: false })
          return
        }
        const meta = input.resolveMediaMeta(mediaId)
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
