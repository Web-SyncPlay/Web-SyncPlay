import { ensureMediasoupRuntime } from "@/server/media/mediasoup-runtime"
import { decodeLocalMediaChunkFrame } from "@/lib/local-media-binary"
import {
  ensureRelaySubscriber,
  resolveLocalMediaChunk,
} from "@/server/media/local-media-relay"
import { ensureLocalMediaReannounceSubscriber } from "@/server/media/local-media-reannounce"
import { startLocalMediaNodeHeartbeat } from "@/server/media/local-media-node-registry"
import { ensureBackgroundMaintenance } from "@/server/maintenance"
import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import { handleSocketDisconnect } from "@/server/realtime/services/disconnect"
import { subscribeRoomUpdates } from "@/server/redis/pubsub"
import { getRoomStateStore } from "@/server/redis/state-store"
import { getSocketMeta, removeSocket } from "@/server/ws/registry"
import { shouldSkipDuplicateRequest } from "@/server/ws/request-dedupe"
import { attachWebSocketTransport } from "@/server/ws/transport"
import { wsEnvelopeSchema } from "@/zod/schemas"
import type { WsEnvelope } from "@/zod/types"
import type { Server as HttpServer } from "node:http"
import type { RawData, WebSocket } from "ws"
import { roomMessageHandlers } from "./handlers/index"
import { handleRoomJoin } from "./handlers/join"
import type { RoomMessageContext } from "./handlers/types"
import type { RoomStateStorePort } from "./ports"

function rawDataToBuffer(message: RawData): Buffer {
  if (Buffer.isBuffer(message)) return message
  if (message instanceof ArrayBuffer) return Buffer.from(message)
  if (Array.isArray(message)) return Buffer.concat(message)
  return Buffer.from(message as Uint8Array)
}

export async function createRealtimeServer(server: HttpServer) {
  const store = await getRoomStateStore()
  getRoomBroadcastBus().attachStore(store)
  void subscribeRoomUpdates()
  void ensureRelaySubscriber()
  void ensureLocalMediaReannounceSubscriber()
  void ensureBackgroundMaintenance()
  startLocalMediaNodeHeartbeat()
  // In-process mediasoup SFU (UDP 40000). Warns and continues if worker cannot start.
  void ensureMediasoupRuntime()

  attachWebSocketTransport(server, (ws) => {
    setupWebSocketConnection(ws, store)
  })
}

function setupWebSocketConnection(ws: WebSocket, store: RoomStateStorePort) {
  console.log("[realtime] websocket connected")

  ws.on("close", async (code, reason) => {
    console.log(
      `[realtime] websocket disconnected code=${code} reason=${reason.toString()}`,
    )
    const meta = removeSocket(ws)
    if (!meta) {
      return
    }
    try {
      await handleSocketDisconnect(store, meta)
    } catch (error) {
      console.error("[realtime] disconnect handling failed", error)
    }
  })

  ws.on("message", async (message, isBinary) => {
    try {
      await handleSocketMessage(ws, store, message, isBinary)
    } catch (error) {
      console.error("[realtime] message handling failed", error)
    }
  })
}

async function handleSocketMessage(
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

async function dispatchJsonEnvelope(
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
  if (!meta) {
    return
  }

  await store.touchWsPresence(meta.roomId, meta.userId)

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
    controlAuthorized: meta.controlAuthorized,
    isControlSession: meta.isControlSession,
    sessionKind: meta.sessionKind,
  }
  await handler(ctx, data)
}
