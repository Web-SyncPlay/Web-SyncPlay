import {
  LocalMediaRelayError,
  type LocalMediaChunkPayload,
} from "@/server/media/local-media-relay/types"
import { getCommandClient } from "@/server/redis/client"
import { keys } from "@/server/redis/keys"
import { localMediaErrorFromMessage } from "@/lib/local-media-errors"

/** JSON-safe payload for Redis (Uint8Array → dataBase64). */
export function serializeRelayReplyPayload(payload: LocalMediaChunkPayload) {
  if (payload.data !== undefined && !payload.dataBase64) {
    return {
      requestId: payload.requestId,
      ok: payload.ok,
      dataBase64: Buffer.from(payload.data).toString("base64"),
      error: payload.error,
    }
  }
  return {
    requestId: payload.requestId,
    ok: payload.ok,
    dataBase64: payload.dataBase64,
    error: payload.error,
  }
}

export async function pushRelayReply(
  requestId: string,
  payload: LocalMediaChunkPayload,
) {
  try {
    const client = await getCommandClient()
    const key = keys.localMediaRelayReply(requestId)
    await client.rPush(key, JSON.stringify(serializeRelayReplyPayload(payload)))
    await client.expire(key, 60)
  } catch (error) {
    console.warn("[local-media-relay] reply push failed", {
      requestId,
      error,
    })
  }
}

export function bytesFromChunkPayload(
  payload: LocalMediaChunkPayload,
): Uint8Array | null {
  if (payload.data !== undefined) {
    return payload.data
  }
  if (payload.dataBase64) {
    return Uint8Array.from(Buffer.from(payload.dataBase64, "base64"))
  }
  return null
}

export function throwFromChunkPayload(payload: LocalMediaChunkPayload): never {
  const code = localMediaErrorFromMessage(payload.error)
  throw new LocalMediaRelayError(code, payload.error)
}
