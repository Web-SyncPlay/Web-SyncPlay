import { ensureMediasoupRuntime } from "@/server/media/mediasoup-runtime"
import {
  ensureRelaySubscriber,
} from "@/server/media/local-media-relay"
import { ensureLocalMediaReannounceSubscriber } from "@/server/media/local-media-reannounce"
import { startLocalMediaNodeHeartbeat } from "@/server/media/local-media-node-registry"
import { ensureBackgroundMaintenance } from "@/server/maintenance"
import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import { handleSocketDisconnect } from "@/server/realtime/services/disconnect"
import { wireRealtimePorts } from "@/server/realtime/wire-ports"
import { subscribeRoomUpdates } from "@/server/redis/pubsub"
import { getRoomStateStore } from "@/server/redis/state-store"
import { removeSocket } from "@/server/ws/registry"
import { attachWebSocketTransport } from "@/server/ws/transport"
import type { Server as HttpServer } from "node:http"
import type { WebSocket } from "ws"
import type { RoomStateStorePort } from "./ports"
import { handleSocketMessage } from "./socket-dispatch"

export async function createRealtimeServer(server: HttpServer) {
  wireRealtimePorts()
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

  // Serialize async message handlers per socket so join commit / presence
  // cannot race later room:* handlers on the same connection (R3).
  let messageQueue: Promise<void> = Promise.resolve()

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

  ws.on("message", (message, isBinary) => {
    messageQueue = messageQueue
      .then(async () => {
        try {
          await handleSocketMessage(ws, store, message, isBinary)
        } catch (error) {
          console.error("[realtime] message handling failed", error)
        }
      })
      .catch((error) => {
        console.error("[realtime] message queue failed", error)
      })
  })
}
