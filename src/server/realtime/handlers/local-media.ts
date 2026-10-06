import {
  resolveLocalMediaChunk,
  type LocalMediaChunkPayload,
} from "@/server/media/local-media-relay"
import { setLocalMediaProviderReady } from "@/server/media/local-media-store"
import type { RoomMessageHandler } from "@/server/realtime/handlers/types"
import { localMediaChunkSchema, localMediaReadySchema } from "@/zod/schemas"

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
