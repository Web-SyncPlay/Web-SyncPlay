"use client"

import { LOCAL_MEDIA_MAX_BLOCK_BYTES } from "@/shared/local-media/local-media-block-protocol"
import {
  nextDeliveryModeAfterFailure,
  pickFirstReadyDeliveryMode,
  planLocalMediaDeliveryAttempts,
  type LocalMediaDeliveryMode,
} from "@/client/local-media/local-media-sfu-transitions"

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

export type LocalMediaSwBridgeDeps = {
  /** Live room-socket SFU flag (false for Bun/no-mediasoup and after sfu:unavailable). */
  getSfuAvailable: () => boolean
  resolveProviderUserId: (localMediaId: string) => string | null
  resolveMediaMeta: (
    localMediaId: string,
  ) => { mimeType: string; sizeBytes: number } | null
  fetchViaSfu?: (
    localMediaId: string,
    start: number,
    end: number,
    timeoutMs: number,
  ) => Promise<Uint8Array | null>
  fetchViaWebrtc?: (input: {
    localMediaId: string
    providerUserId: string
    start: number
    end: number
  }) => Promise<Uint8Array | null>
  warmSfuViewer?: (localMediaId: string) => void
  isSfuViewerReady?: (localMediaId: string) => boolean
  /** Viewer could not get P2P bytes — runtime may warm invites. */
  onP2pRangeMiss?: (localMediaId: string, providerUserId: string) => void
}

/**
 * Bridge SW range requests to the in-page mediasoup SFU, then WebRTC mesh.
 * Delivery order: SFU → P2P → (SW falls back to HTTP). Call once per room
 * session from the socket hook. Fetch helpers are injectable so the runtime
 * owns transport configuration.
 */
export function attachLocalMediaServiceWorkerBridge(
  input: LocalMediaSwBridgeDeps,
): () => void {
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

        let bytes: Uint8Array | null = null
        let source: "sfu" | "webrtc" = "sfu"

        const sfuMod =
          input.fetchViaSfu &&
          input.isSfuViewerReady &&
          input.warmSfuViewer
            ? null
            : await import("@/client/local-media/local-media-sfu")

        const fetchViaSfu =
          input.fetchViaSfu ?? sfuMod!.fetchLocalMediaRangeViaSfu
        const isSfuViewerReady =
          input.isSfuViewerReady ?? sfuMod!.isLocalMediaSfuViewerReady
        const warmSfuViewer =
          input.warmSfuViewer ?? sfuMod!.warmLocalMediaSfuViewer

        const attempts = planLocalMediaDeliveryAttempts({
          sfuAvailable: input.getSfuAvailable(),
          sfuViewerReady: isSfuViewerReady(mediaId),
          providerUserId,
        })
        if (attempts.some((a) => a.mode === "sfu" && !a.ready)) {
          warmSfuViewer(mediaId)
        }

        let mode: LocalMediaDeliveryMode | null =
          pickFirstReadyDeliveryMode(attempts)
        while (mode === "sfu" || mode === "p2p") {
          try {
            if (mode === "sfu") {
              source = "sfu"
              bytes = await fetchViaSfu(mediaId, start, end, 5000)
            } else {
              source = "webrtc"
              const fetchViaWebrtc =
                input.fetchViaWebrtc ??
                (
                  await import("@/client/local-media/local-media-webrtc")
                ).fetchLocalMediaRangeViaWebrtc
              bytes = await fetchViaWebrtc({
                localMediaId: mediaId,
                providerUserId: providerUserId!,
                start,
                end,
              })
              if (!bytes && providerUserId) {
                input.onP2pRangeMiss?.(mediaId, providerUserId)
              }
            }
          } catch (error) {
            console.warn(`[local-media] ${mode} range fetch failed`, error)
            bytes = null
            if (mode === "p2p" && providerUserId) {
              input.onP2pRangeMiss?.(mediaId, providerUserId)
            }
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
