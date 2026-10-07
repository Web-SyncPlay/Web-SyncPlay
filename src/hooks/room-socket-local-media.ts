"use client"

import type { SfuResult, SfuSendRequest } from "@/lib/local-media-sfu"
import type { TypedRoomEventSender } from "@/lib/room-events"
import type {
  RoomSnapshotPayload,
  RoomState,
  WsEnvelope,
} from "@/zod/types"
import type { MutableRefObject } from "react"

type LocalMediaSocketSession = {
  sendSfuRequest: SfuSendRequest
  provideViaSfu: (localMediaId: string) => void
  /** Returns true when the envelope was handled as a local-media message. */
  handleEnvelope: (envelope: WsEnvelope<string, unknown>) => boolean
  bootstrapAfterFirstSnapshot: (payload: RoomSnapshotPayload) => void
  onSocketClose: () => void
}

/**
 * Owns SFU request correlation, local-media wire handlers, and the
 * first-snapshot bootstrap (restore handles, SW bridge, ABR republish).
 * Keeps reconnect semantics in the caller — this only tears down SFU state.
 */
export function createRoomSocketLocalMediaSession(input: {
  ws: WebSocket
  roomId: string
  userId: string
  roomStateRef: MutableRefObject<RoomState | null>
  getDetachSwBridge: () => (() => void) | null
  setDetachSwBridge: (detach: (() => void) | null) => void
}): LocalMediaSocketSession {
  const { ws, roomId, userId, roomStateRef } = input

  const sfuPending = new Map<string, (result: SfuResult) => void>()
  let sfuAvailable = false
  const pendingSfuProvide = new Set<string>()

  /** Fire-and-forget room WS envelope (no correlation). */
  const sendEnvelope = (
    type: string,
    payload: Record<string, unknown>,
  ): boolean => {
    if (ws.readyState !== WebSocket.OPEN) return false
    ws.send(
      JSON.stringify({
        type,
        payload,
        requestId: crypto.randomUUID(),
      }),
    )
    return true
  }

  const sendSfuRequest: SfuSendRequest = (type, payload) =>
    new Promise<SfuResult>((resolve) => {
      if (ws.readyState !== WebSocket.OPEN) {
        resolve({ ok: false, error: "socket_closed" })
        return
      }
      const requestId = crypto.randomUUID()
      const timer = window.setTimeout(() => {
        sfuPending.delete(requestId)
        resolve({ ok: false, error: "sfu_request_timeout" })
      }, 15_000)
      sfuPending.set(requestId, (result) => {
        window.clearTimeout(timer)
        resolve(result)
      })
      ws.send(JSON.stringify({ type, payload, requestId }))
    })

  const flushSfuPending = () => {
    for (const [id, resolve] of sfuPending) {
      sfuPending.delete(id)
      resolve({ ok: false, error: "socket_closed" })
    }
  }

  const provideViaSfu = (localMediaId: string) => {
    if (!sfuAvailable) {
      pendingSfuProvide.add(localMediaId)
      return
    }
    void import("@/lib/local-media-sfu").then(({ ensureLocalMediaSfuProvider }) =>
      ensureLocalMediaSfuProvider(localMediaId, sendSfuRequest),
    )
  }

  const handleLocalMediaRead = (envelope: WsEnvelope<string, unknown>) => {
    const payload = envelope.payload as {
      requestId?: string
      localMediaId?: string
      start?: number
      end?: number
    }
    const requestId = payload.requestId
    const localMediaId = payload.localMediaId
    const start = payload.start
    const end = payload.end
    if (
      !requestId ||
      !localMediaId ||
      typeof start !== "number" ||
      typeof end !== "number"
    ) {
      return
    }

    void (async () => {
      const { getLocalMediaFile } = await import("@/lib/local-media-provider")
      const { encodeLocalMediaChunkFrame } = await import(
        "@/lib/local-media-binary"
      )
      const file = getLocalMediaFile(localMediaId)
      // Stay silent when this tab does not hold the File so another
      // session for the same user can still answer the range request.
      if (!file) {
        return
      }
      try {
        const slice = file.slice(start, end + 1)
        const buffer = await slice.arrayBuffer()
        // Binary LMC frame avoids ~33% base64 overhead on the wire.
        const frame = encodeLocalMediaChunkFrame({
          requestId,
          ok: true,
          data: new Uint8Array(buffer),
        })
        // Fresh ArrayBuffer-backed view satisfies DOM WebSocket BufferSource typings.
        const wire = new Uint8Array(frame.byteLength)
        wire.set(frame)
        ws.send(wire)
      } catch (error) {
        console.error("[local-media] failed to read range", {
          localMediaId,
          requestId,
          start,
          end,
          error,
        })
        // Keep JSON error path for simplicity / older server compat.
        ws.send(
          JSON.stringify({
            type: "local-media:chunk",
            requestId: crypto.randomUUID(),
            payload: {
              requestId,
              ok: false,
              error: "read_failed",
            },
          }),
        )
      }
    })()
  }

  const handleSfuResult = (envelope: WsEnvelope<string, unknown>) => {
    const requestId = envelope.requestId
    const resolve = requestId ? sfuPending.get(requestId) : undefined
    if (!requestId || !resolve) return
    sfuPending.delete(requestId)
    resolve(envelope.payload as SfuResult)
  }

  const handleSfuProducer = (envelope: WsEnvelope<string, unknown>) => {
    if (!sfuAvailable) return
    const payload = envelope.payload as {
      localMediaId?: string
      dataProducerId?: string
      ownerUserId?: string
      kind?: "provider" | "requests"
    }
    const { localMediaId, dataProducerId, ownerUserId } = payload
    if (!localMediaId || !dataProducerId || !ownerUserId) return
    const isSelfOwner = ownerUserId === userId

    void (async () => {
      const sfu = await import("@/lib/local-media-sfu")
      const { getLocalMediaFile } = await import("@/lib/local-media-provider")
      const holdsFile = Boolean(getLocalMediaFile(localMediaId))
      if (payload.kind === "requests") {
        if (isSelfOwner && holdsFile) {
          await sfu.ensureLocalMediaSfuRequestConsumer(
            localMediaId,
            dataProducerId,
            sendSfuRequest,
          )
        }
        return
      }
      if (!holdsFile) {
        await sfu.ensureLocalMediaSfuViewer(localMediaId, sendSfuRequest)
      }
    })()
  }

  const handleWebrtcSignal = (envelope: WsEnvelope<string, unknown>) => {
    const payload = envelope.payload as {
      localMediaId?: string
      fromUserId?: string
      signal?: {
        type: "offer" | "answer" | "ice" | "hangup"
        sdp?: string
        candidate?: string
        sdpMid?: string
        sdpMLineIndex?: number
      }
    }
    if (!payload.localMediaId || !payload.fromUserId || !payload.signal) {
      return
    }
    void import("@/lib/local-media-webrtc").then(
      async ({ handleLocalMediaWebrtcSignalFromPeer }) => {
        const { getLocalMediaFile } = await import("@/lib/local-media-provider")
        await handleLocalMediaWebrtcSignalFromPeer({
          localMediaId: payload.localMediaId!,
          fromUserId: payload.fromUserId!,
          signal: payload.signal!,
          isProvider: Boolean(getLocalMediaFile(payload.localMediaId!)),
        })
      },
    )
  }

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

  const handleEnvelope = (envelope: WsEnvelope<string, unknown>): boolean => {
    switch (envelope.type) {
      case "local-media:read":
        handleLocalMediaRead(envelope)
        return true
      case "local-media:sfu:result":
        handleSfuResult(envelope)
        return true
      case "local-media:sfu:producer":
        handleSfuProducer(envelope)
        return true
      case "local-media:webrtc:signal":
        handleWebrtcSignal(envelope)
        return true
      case "local-media:reannounce":
        handleReannounce()
        return true
      default:
        return false
    }
  }

  const bootstrapAfterFirstSnapshot = (payload: RoomSnapshotPayload) => {
    void (async () => {
      // Ask for SFU capabilities now so IndexedDB restore does not delay it.
      const capabilitiesRequest =
        ws.readyState === WebSocket.OPEN
          ? sendSfuRequest("local-media:sfu:capabilities", {})
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
          sfuAvailable = true
          configureLocalMediaSfu(sendSfuRequest)
          const toProvide = new Set([
            ...pendingSfuProvide,
            ...listLocalMediaIds(),
          ])
          pendingSfuProvide.clear()
          for (const localMediaId of toProvide) {
            provideViaSfu(localMediaId)
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
            void ensureLocalMediaSfuViewer(localMediaId, sendSfuRequest)
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
        provideViaSfu(localMediaId)
      }
    })()
  }

  const onSocketClose = () => {
    sfuAvailable = false
    pendingSfuProvide.clear()
    input.getDetachSwBridge()?.()
    input.setDetachSwBridge(null)
    flushSfuPending()
    void import("@/lib/local-media-sfu").then(({ closeLocalMediaSfu }) =>
      closeLocalMediaSfu(sendSfuRequest),
    )
  }

  return {
    sendSfuRequest,
    provideViaSfu,
    handleEnvelope,
    bootstrapAfterFirstSnapshot,
    onSocketClose,
  }
}
