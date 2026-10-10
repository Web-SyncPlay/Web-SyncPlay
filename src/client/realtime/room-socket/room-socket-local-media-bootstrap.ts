import type { TypedRoomEventSender } from "@/contracts/room-events"
import type { ClientRoomState, RoomSnapshotPayload } from "@/contracts/types"
import type { MutableRefObject } from "react"
import type { LocalMediaRuntime } from "@/client/local-media/local-media-runtime"
import type { LocalMediaSfuSession } from "./room-socket-local-media-sfu"
import type { SendEnvelope } from "./room-socket-local-media-send"

function aborted(signal: AbortSignal | undefined): boolean {
  return Boolean(signal?.aborted)
}

/**
 * First-snapshot bootstrap: SFU capabilities, handle restore, SW bridge,
 * ABR republish, and lazy WebRTC viewer invites.
 */
export function createLocalMediaBootstrap(input: {
  ws: WebSocket
  roomId: string
  userId: string
  roomStateRef: MutableRefObject<ClientRoomState | null>
  getDetachSwBridge: () => (() => void) | null
  setDetachSwBridge: (detach: (() => void) | null) => void
  sendEnvelope: SendEnvelope
  sfu: LocalMediaSfuSession
  runtime: LocalMediaRuntime
}) {
  const {
    ws,
    roomId,
    userId,
    roomStateRef,
    sendEnvelope,
    sfu,
    runtime,
  } = input

  const handleReannounce = (signal?: AbortSignal) => {
    void (async () => {
      const { announceLocalMediaProviderReady, registerLocalMediaFile } =
        await import("@/client/local-media/local-media-provider")
      const { restoreLocalMediaHandles } = await import(
        "@/client/local-media/local-media-handles"
      )
      if (aborted(signal) || ws.readyState !== WebSocket.OPEN) return
      await restoreLocalMediaHandles({
        roomId,
        userId,
        register: registerLocalMediaFile,
      })
      if (aborted(signal) || ws.readyState !== WebSocket.OPEN) return
      announceLocalMediaProviderReady(
        (type, readyPayload) => {
          sendEnvelope(type, readyPayload as Record<string, unknown>)
        },
        roomStateRef.current,
        userId,
      )
    })()
  }

  const bootstrapAfterFirstSnapshot = (
    payload: RoomSnapshotPayload,
    signal?: AbortSignal,
  ) => {
    void (async () => {
      if (aborted(signal)) return

      // Ask for SFU capabilities now so IndexedDB restore does not delay it.
      const capabilitiesRequest =
        ws.readyState === WebSocket.OPEN
          ? sfu.sendSfuRequest("local-media:sfu:capabilities", {})
          : null
      if (capabilitiesRequest) {
        void capabilitiesRequest.then(async (capabilities) => {
          if (
            aborted(signal) ||
            !capabilities.ok ||
            ws.readyState !== WebSocket.OPEN
          ) {
            return
          }
          const [
            { ensureLocalMediaSfuViewer },
            { listLocalMediaIds, getLocalMediaFile },
          ] = await Promise.all([
            import("@/client/local-media/local-media-sfu"),
            import("@/client/local-media/local-media-provider"),
          ])
          if (aborted(signal) || ws.readyState !== WebSocket.OPEN) return
          sfu.markSfuAvailable()
          await runtime.configureSfu(sfu.sendSfuRequest)
          if (aborted(signal) || ws.readyState !== WebSocket.OPEN) return
          const toProvide = new Set([
            ...sfu.drainPendingProvides(),
            ...listLocalMediaIds(),
          ])
          for (const localMediaId of toProvide) {
            sfu.provideViaSfu(localMediaId)
          }
          // Late joiners missed produce broadcasts; consume existing SFU producers.
          const announced = Array.isArray(capabilities.producers)
            ? (capabilities.producers as Array<{
                localMediaId?: string
              }>)
            : []
          const fromPlaylist = (roomStateRef.current?.playlist ?? [])
            .map((item) => item.localMediaId)
            .filter((id): id is string => Boolean(id))
          for (const localMediaId of new Set([
            ...announced
              .map((p) => p.localMediaId)
              .filter((id): id is string => Boolean(id)),
            ...fromPlaylist,
          ])) {
            if (getLocalMediaFile(localMediaId)) continue
            void ensureLocalMediaSfuViewer(localMediaId, sfu.sendSfuRequest)
          }
        })
      }

      const {
        announceLocalMediaProviderReady,
        registerLocalMediaFile,
        listLocalMediaIds,
      } = await import("@/client/local-media/local-media-provider")
      const { restoreLocalMediaHandles } = await import(
        "@/client/local-media/local-media-handles"
      )
      const {
        registerLocalMediaServiceWorker,
      } = await import("@/client/local-media/local-media-sw")
      const { resolveLocalMediaProviderUserId, resolveLocalMediaMeta } =
        await import("@/client/local-media/local-media-resolve")

      if (aborted(signal) || ws.readyState !== WebSocket.OPEN) return

      await runtime.configureWebrtc()
      if (aborted(signal) || ws.readyState !== WebSocket.OPEN) return

      void registerLocalMediaServiceWorker()
      input.getDetachSwBridge()?.()
      input.setDetachSwBridge(
        runtime.attachSwBridge({
          getSfuAvailable: sfu.getSfuAvailable,
          resolveProviderUserId: (localMediaId) =>
            resolveLocalMediaProviderUserId(roomStateRef.current, localMediaId),
          resolveMediaMeta: (localMediaId) =>
            resolveLocalMediaMeta(roomStateRef.current, localMediaId),
        }),
      )

      await restoreLocalMediaHandles({
        roomId,
        userId,
        register: registerLocalMediaFile,
      })
      if (aborted(signal) || ws.readyState !== WebSocket.OPEN) return
      announceLocalMediaProviderReady(
        (type, readyPayload) => {
          sendEnvelope(type, readyPayload as Record<string, unknown>)
        },
        payload,
        userId,
      )

      // Re-package ABR ladder for restored Files (children are lost on refresh).
      const sendTyped: TypedRoomEventSender = (type, eventPayload) => {
        sendEnvelope(type, eventPayload as Record<string, unknown>)
      }
      void (async () => {
        const { runLocalMediaAbrPublish } = await import(
          "@/client/local-media/local-media-abr"
        )
        const { getLocalMediaFile, getLocalMediaMimeType } = await import(
          "@/client/local-media/local-media-provider"
        )
        for (const item of payload.playlist) {
          if (aborted(signal)) return
          if (item.sourceKind !== "local_file") continue
          if (item.localOriginUserId !== userId) continue
          const parentId = item.localMediaId
          if (!parentId) continue
          const file = getLocalMediaFile(parentId)
          if (!file) continue
          const mime =
            getLocalMediaMimeType(parentId) ??
            item.localMimeType ??
            "video/mp4"
          void runLocalMediaAbrPublish({
            parentLocalMediaId: parentId,
            file,
            mimeType: mime,
            name: item.name || "Local media",
            send: sendTyped,
          })
        }
      })()

      // Lazy P2P: current playlist item only (not O(participants × media)).
      // Further invites happen on first successful range serve via the runtime.
      runtime.inviteWebrtcForCurrentItem(payload)

      const held = listLocalMediaIds()
      // Files restored from IndexedDB are published once the SFU is
      // available (queued if capabilities are still pending).
      for (const localMediaId of held) {
        sfu.provideViaSfu(localMediaId)
      }
    })()
  }

  return { bootstrapAfterFirstSnapshot, handleReannounce }
}
