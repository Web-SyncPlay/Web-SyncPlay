import type { TypedRoomEventSender } from "@/lib/room-events"
import type { RoomSnapshotPayload, RoomState } from "@/zod/types"
import type { MutableRefObject } from "react"
import type { LocalMediaSfuSession } from "./room-socket-local-media-sfu"
import type { SendEnvelope } from "./room-socket-local-media-send"

/**
 * First-snapshot bootstrap: SFU capabilities, handle restore, SW bridge,
 * ABR republish, and WebRTC viewer invites.
 */
export function createLocalMediaBootstrap(input: {
  ws: WebSocket
  roomId: string
  userId: string
  roomStateRef: MutableRefObject<RoomState | null>
  getDetachSwBridge: () => (() => void) | null
  setDetachSwBridge: (detach: (() => void) | null) => void
  sendEnvelope: SendEnvelope
  sfu: LocalMediaSfuSession
}) {
  const {
    ws,
    roomId,
    userId,
    roomStateRef,
    sendEnvelope,
    sfu,
  } = input

  const handleReannounce = () => {
    void (async () => {
      const { announceLocalMediaProviderReady, registerLocalMediaFile } =
        await import("@/lib/local-media-provider")
      const { restoreLocalMediaHandles } = await import(
        "@/lib/local-media-handles"
      )
      if (ws.readyState !== WebSocket.OPEN) return
      await restoreLocalMediaHandles({
        roomId,
        userId,
        register: registerLocalMediaFile,
      })
      if (ws.readyState !== WebSocket.OPEN) return
      announceLocalMediaProviderReady(
        (type, readyPayload) => {
          sendEnvelope(type, readyPayload as Record<string, unknown>)
        },
        roomStateRef.current,
        userId,
      )
    })()
  }

  const bootstrapAfterFirstSnapshot = (payload: RoomSnapshotPayload) => {
    void (async () => {
      // Ask for SFU capabilities now so IndexedDB restore does not delay it.
      const capabilitiesRequest =
        ws.readyState === WebSocket.OPEN
          ? sfu.sendSfuRequest("local-media:sfu:capabilities", {})
          : null
      if (capabilitiesRequest) {
        void capabilitiesRequest.then(async (capabilities) => {
          if (!capabilities.ok || ws.readyState !== WebSocket.OPEN) {
            return
          }
          const [
            { configureLocalMediaSfu, ensureLocalMediaSfuViewer },
            { listLocalMediaIds, getLocalMediaFile },
          ] = await Promise.all([
            import("@/lib/local-media-sfu"),
            import("@/lib/local-media-provider"),
          ])
          if (ws.readyState !== WebSocket.OPEN) return
          sfu.markSfuAvailable()
          configureLocalMediaSfu(sfu.sendSfuRequest)
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
      } = await import("@/lib/local-media-provider")
      const { restoreLocalMediaHandles } = await import(
        "@/lib/local-media-handles"
      )
      const { inviteLocalMediaWebrtcViewer, configureLocalMediaWebrtc } =
        await import("@/lib/local-media-webrtc")
      const {
        registerLocalMediaServiceWorker,
        attachLocalMediaServiceWorkerBridge,
      } = await import("@/lib/local-media-sw")
      const { resolveLocalMediaProviderUserId, resolveLocalMediaMeta } =
        await import("@/lib/local-media-resolve")

      if (ws.readyState !== WebSocket.OPEN) return

      configureLocalMediaWebrtc({
        sendSignal: (targetUserId, localMediaId, signal) => {
          sendEnvelope("local-media:webrtc:signal", {
            localMediaId,
            targetUserId,
            signal,
          })
        },
      })
      void registerLocalMediaServiceWorker()
      input.getDetachSwBridge()?.()
      input.setDetachSwBridge(
        attachLocalMediaServiceWorkerBridge({
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
      if (ws.readyState !== WebSocket.OPEN) return
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
          "@/lib/local-media-abr"
        )
        const { getLocalMediaFile, getLocalMediaMimeType } = await import(
          "@/lib/local-media-provider"
        )
        for (const item of payload.playlist) {
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

      // Provider invites other room members onto DataChannels (C0 mesh).
      const held = listLocalMediaIds()
      if (held.length > 0) {
        for (const participant of Object.values(payload.participants)) {
          if (participant.userId === userId) continue
          if (!participant.connected) continue
          for (const localMediaId of held) {
            void inviteLocalMediaWebrtcViewer({
              localMediaId,
              viewerUserId: participant.userId,
            })
          }
        }
      }

      // Files restored from IndexedDB are published once the SFU is
      // available (queued if capabilities are still pending).
      for (const localMediaId of held) {
        sfu.provideViaSfu(localMediaId)
      }
    })()
  }

  return { bootstrapAfterFirstSnapshot, handleReannounce }
}
