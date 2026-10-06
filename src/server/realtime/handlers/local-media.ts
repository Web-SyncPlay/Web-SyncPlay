import {
  resolveLocalMediaChunk,
  type LocalMediaChunkPayload,
} from "@/server/media/local-media-relay"
import type { RoomMessageHandler } from "@/server/realtime/handlers/types"
import { localMediaChunkSchema } from "@/zod/schemas"

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
