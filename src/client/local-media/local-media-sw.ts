"use client"

import { readLocalMediaRange } from "@/client/local-media/local-media-file-read"
import { getLocalMediaFile } from "@/client/local-media/local-media-provider"
import {
  nextDeliveryModeAfterFailure,
  pickFirstReadyDeliveryMode,
  planLocalMediaDeliveryAttempts,
  type LocalMediaDeliveryMode,
} from "@/client/local-media/local-media-sfu-transitions"
import { LOCAL_MEDIA_MAX_BLOCK_BYTES } from "@/shared/local-media/local-media-block-protocol"

/** Register the local-media Service Worker that prefers WebRTC ranges. */
export async function registerLocalMediaServiceWorker(): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return
  }
  try {
    await navigator.serviceWorker.register("/local-media-sw.js", {
      scope: "/",
    })
    const { resyncLocalMediaViewerTokenToServiceWorker } =
      await import("@/client/local-media/local-media-viewer-token")
    if (navigator.serviceWorker.controller) {
      resyncLocalMediaViewerTokenToServiceWorker()
    } else {
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => {
          resyncLocalMediaViewerTokenToServiceWorker()
        },
        { once: true },
      )
    }
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
    timeoutMs?: number
    requireOpenChannel?: boolean
  }) => Promise<Uint8Array | null>
  warmSfuViewer?: (localMediaId: string) => void
  isSfuViewerReady?: (localMediaId: string) => boolean
  isWebrtcChannelOpen?: (
    localMediaId: string,
    providerUserId: string,
  ) => boolean
  /** Viewer could not get P2P bytes — runtime may warm invites. */
  onP2pRangeMiss?: (localMediaId: string, providerUserId: string) => void
}

/**
 * Bridge SW range requests to local File (provider) or SFU / WebRTC (viewer).
 * Cold transports return ok:false quickly so the SW can fall back to HTTP
 * without blocking the media element for multi-second ICE / SFU setup.
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
        const meta = input.resolveMediaMeta(mediaId)

        // Provider shortcut: serve from the in-tab File (no SFU/P2P hop).
        const localFile = getLocalMediaFile(mediaId)
        if (localFile) {
          const bytes = await readLocalMediaRange(localFile, start, end)
          port.postMessage(
            {
              requestId: data.requestId,
              ok: true,
              buffer: bytes.buffer,
              mimeType: meta?.mimeType,
              totalSize: meta?.sizeBytes ?? localFile.size,
              source: "local",
            },
            [bytes.buffer],
          )
          return
        }

        const providerUserId = input.resolveProviderUserId(mediaId)

        let bytes: Uint8Array | null = null
        let source: "sfu" | "webrtc" = "sfu"

        const sfuMod =
          input.fetchViaSfu && input.isSfuViewerReady && input.warmSfuViewer
            ? null
            : await import("@/client/local-media/local-media-sfu")
        const webrtcMod =
          input.fetchViaWebrtc && input.isWebrtcChannelOpen
            ? null
            : await import("@/client/local-media/local-media-webrtc")

        const fetchViaSfu =
          input.fetchViaSfu ?? sfuMod!.fetchLocalMediaRangeViaSfu
        const isSfuViewerReady =
          input.isSfuViewerReady ?? sfuMod!.isLocalMediaSfuViewerReady
        const warmSfuViewer =
          input.warmSfuViewer ?? sfuMod!.warmLocalMediaSfuViewer
        const fetchViaWebrtc =
          input.fetchViaWebrtc ?? webrtcMod!.fetchLocalMediaRangeViaWebrtc
        const isWebrtcChannelOpen =
          input.isWebrtcChannelOpen ?? webrtcMod!.isLocalMediaWebrtcChannelOpen

        const sfuViewerReady = isSfuViewerReady(mediaId)
        const p2pOpen =
          !!providerUserId && isWebrtcChannelOpen(mediaId, providerUserId)

        // SW path: only use already-warm transports. Cold SFU/P2P is warmed
        // in the background; HTTP relay serves the current range immediately.
        const attempts = planLocalMediaDeliveryAttempts({
          sfuAvailable: input.getSfuAvailable() && sfuViewerReady,
          sfuViewerReady,
          providerUserId: p2pOpen ? providerUserId : null,
        }).filter((a) => a.mode !== "http")

        if (input.getSfuAvailable() && !sfuViewerReady) {
          warmSfuViewer(mediaId)
        }
        if (providerUserId && !p2pOpen) {
          input.onP2pRangeMiss?.(mediaId, providerUserId)
        }

        let mode: LocalMediaDeliveryMode | null =
          pickFirstReadyDeliveryMode(attempts)
        while (mode === "sfu" || mode === "p2p") {
          try {
            if (mode === "sfu") {
              source = "sfu"
              bytes = await fetchViaSfu(mediaId, start, end, 2_000)
            } else {
              source = "webrtc"
              bytes = await fetchViaWebrtc({
                localMediaId: mediaId,
                providerUserId: providerUserId!,
                start,
                end,
                timeoutMs: 2_000,
                requireOpenChannel: true,
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
        try {
          port.postMessage({ requestId: data.requestId, ok: false })
        } catch {
          // port closed
        }
      }
    })()
  }

  navigator.serviceWorker.addEventListener("message", onMessage)

  const announceBridgeReady = () => {
    try {
      navigator.serviceWorker.controller?.postMessage({
        type: "local-media-sw-bridge-ready",
      })
    } catch {
      // ignore
    }
  }
  announceBridgeReady()
  navigator.serviceWorker.addEventListener(
    "controllerchange",
    announceBridgeReady,
  )

  return () => {
    navigator.serviceWorker.removeEventListener("message", onMessage)
    navigator.serviceWorker.removeEventListener(
      "controllerchange",
      announceBridgeReady,
    )
  }
}
