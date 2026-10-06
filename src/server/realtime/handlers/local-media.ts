import {
  resolveLocalMediaChunk,
  type LocalMediaChunkPayload,
} from "@/server/media/local-media-relay"
import { setLocalMediaProviderReady } from "@/server/media/local-media-store"
import type { RoomMessageHandler } from "@/server/realtime/handlers/types"
import { getSocketsForUser } from "@/server/ws/registry"
import {
  localMediaChunkSchema,
  localMediaReadySchema,
  localMediaWebrtcSignalSchema,
} from "@/zod/schemas"
import { randomUUID } from "node:crypto"

export const handleLocalMediaChunk: RoomMessageHandler = async (_ctx, data) => {
  const parsed = localMediaChunkSchema.safeParse(data.payload)
  if (!parsed.success) return

  const payload: LocalMediaChunkPayload = {
    requestId: parsed.data.requestId,
    ok: parsed.data.ok,
    dataBase64: parsed.data.dataBase64,
    error: parsed.data.error,
  }
  resolveLocalMediaChunk(payload)
}

export const handleLocalMediaReady: RoomMessageHandler = async (ctx, data) => {
  const parsed = localMediaReadySchema.safeParse(data.payload)
  if (!parsed.success) return

  await setLocalMediaProviderReady(parsed.data.localMediaId, parsed.data.ready, {
    ownerUserId: ctx.userId,
  })
}

/**
 * Relay WebRTC signaling between peers in the same room.
 * Does not interpret SDP — only fan-out to the target user's sockets.
 */
export const handleLocalMediaWebrtcSignal: RoomMessageHandler = async (
  ctx,
  data,
) => {
  const parsed = localMediaWebrtcSignalSchema.safeParse(data.payload)
  if (!parsed.success) return
  if (parsed.data.targetUserId === ctx.userId) return

  const envelope = JSON.stringify({
    type: "local-media:webrtc:signal",
    requestId: randomUUID(),
    payload: {
      localMediaId: parsed.data.localMediaId,
      fromUserId: ctx.userId,
      signal: parsed.data.signal,
    },
  })

  for (const socket of getSocketsForUser(ctx.roomId, parsed.data.targetUserId)) {
    if (socket.readyState === socket.OPEN) {
      socket.send(envelope)
    }
  }
}
