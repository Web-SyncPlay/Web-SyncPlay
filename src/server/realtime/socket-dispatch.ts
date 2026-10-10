import { decodeLocalMediaChunkFrame } from "@/shared/local-media/local-media-binary"
import { resolveLocalMediaChunk } from "@/server/media/local-media-relay"
import { consumeHotWsEventLimit } from "@/server/security/rate-limit"
import { getSocketMeta } from "@/server/ws/registry"
import { shouldSkipDuplicateRequest } from "@/server/ws/request-dedupe"
import { wsEnvelopeSchema } from "@/contracts/schemas"
import type { WsEnvelope } from "@/contracts/types"
import type { RawData, WebSocket } from "ws"
import { roomMessageHandlers } from "./handlers/index"
import { handleRoomJoin } from "./handlers/join"
import {
  sendMutationNack,
  shouldNackAtDispatch,
} from "./handlers/mutation-nack"
import type { RoomMessageContext } from "./handlers/types"
import type { RoomStateStorePort } from "./ports"

export function rawDataToBuffer(message: RawData): Buffer {
  if (Buffer.isBuffer(message)) return message
  if (message instanceof ArrayBuffer) return Buffer.from(message)
  if (Array.isArray(message)) return Buffer.concat(message)
  return Buffer.from(message as Uint8Array)
}

/**
 * Per-message dispatch: binary LMC → relay resolve; other binary ignored;
 * JSON envelopes go through join / joinCommitted / rate / handler gates.
 */
export async function handleSocketMessage(
  ws: WebSocket,
  store: RoomStateStorePort,
  message: RawData,
  isBinary: boolean,
) {
  const buf = rawDataToBuffer(message)

  // Binary LMC frames bypass the JSON envelope / zod path.
  const decoded = decodeLocalMediaChunkFrame(buf)
  if (decoded) {
    resolveLocalMediaChunk({
      requestId: decoded.requestId,
      ok: decoded.ok,
      data: decoded.data,
      error: decoded.error,
    })
    return
  }
  // Non-LMC binary: ignore (do not UTF-8 decode as JSON).
  if (isBinary) {
    return
  }

  await dispatchJsonEnvelope(ws, store, buf.toString("utf8"))
}

export async function dispatchJsonEnvelope(
  ws: WebSocket,
  store: RoomStateStorePort,
  raw: string,
) {
  const parsed = JSON.parse(raw) as unknown
  const envelopeResult = wsEnvelopeSchema.safeParse(parsed)
  if (!envelopeResult.success) {
    console.warn("[realtime] invalid envelope", envelopeResult.error.issues)
    return
  }
  const data = envelopeResult.data as WsEnvelope<
    string,
    Record<string, unknown>
  >
  if (data.requestId && shouldSkipDuplicateRequest(data.requestId)) {
    return
  }

  if (data.type === "room:join") {
    await handleRoomJoin({ ws, store }, data)
    return
  }

  const meta = getSocketMeta(ws)
  // Reject non-join traffic until room:join has committed membership (R3).
  if (!meta?.joinCommitted) {
    if (shouldNackAtDispatch(data.type)) {
      sendMutationNack(ws, data, "not_joined")
    }
    return
  }

  await store.touchWsPresence(meta.roomId, meta.userId)

  // Drop seek/preview/presence floods before Redis pub/sub or room writes.
  const hotLimit = consumeHotWsEventLimit({
    type: data.type,
    roomId: meta.roomId,
    userId: meta.userId,
  })
  if (!hotLimit.allowed) {
    if (shouldNackAtDispatch(data.type)) {
      sendMutationNack(ws, data, "rate_limited")
    }
    return
  }

  const handler =
    roomMessageHandlers[data.type as keyof typeof roomMessageHandlers]
  if (!handler) {
    return
  }

  const ctx: RoomMessageContext = {
    ws,
    store,
    roomId: meta.roomId,
    userId: meta.userId,
    connectionId: meta.connectionId,
    controlAuthorized: meta.controlAuthorized,
    isControlSession: meta.isControlSession,
    sessionKind: meta.sessionKind,
  }
  await handler(ctx, data)
}
