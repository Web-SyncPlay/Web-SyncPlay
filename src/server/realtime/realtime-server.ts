import { ensureRelaySubscriber } from "@/server/media/local-media-relay"
import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import { handleSocketDisconnect } from "@/server/realtime/services/disconnect"
import { subscribeRoomUpdates } from "@/server/redis/pubsub"
import { getRoomStateStore } from "@/server/redis/state-store"
import { getSocketMeta, removeSocket } from "@/server/ws/registry"
import { shouldSkipDuplicateRequest } from "@/server/ws/request-dedupe"
import { attachWebSocketTransport, getLastPongMap } from "@/server/ws/transport"
import { wsEnvelopeSchema } from "@/zod/schemas"
import type { WsEnvelope } from "@/zod/types"
import type { Server as HttpServer } from "node:http"
import type { WebSocket } from "ws"
import { roomMessageHandlers } from "./handlers/index"
import { handleRoomJoin } from "./handlers/join"

export async function createRealtimeServer(server: HttpServer) {
  const store = await getRoomStateStore()
  getRoomBroadcastBus().attachStore(store)
  wirePubSubFanOut()
  void ensureRelaySubscriber()
  attachWebSocketTransport(server, (ws) => {
    setupWebSocketConnection(ws, store)
  })
}

function wirePubSubFanOut() {
  void subscribeRoomUpdates()
}

function setupWebSocketConnection(
  ws: WebSocket,
  store: Awaited<ReturnType<typeof getRoomStateStore>>,
) {
  console.log("[realtime] websocket connected")

  ws.on("close", async (code, reason) => {
    console.log(
      `[realtime] websocket disconnected code=${code} reason=${reason.toString()}`,
    )
    getLastPongMap().delete(ws)
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

  ws.on("message", async (message) => {
    try {
      const raw = message.toString()
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
      if (handler) {
        await handler(
          {
            ws,
            store,
            roomId: meta.roomId,
            userId: meta.userId,
            controlAuthorized: meta.controlAuthorized,
            isControlSession: meta.isControlSession,
            sessionKind: meta.sessionKind,
          },
          data,
        )
      }
    } catch (error) {
      console.error("[realtime] message handling failed", error)
    }
  })
}
