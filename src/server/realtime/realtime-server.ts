import { appendActionLog } from "@/server/log"
import { deleteLocalMediaEntriesForOwner } from "@/server/media/local-media-store"
import {
  applyOfflinePruning,
  clearAllRoomPrunes,
  schedulePrune,
} from "@/server/realtime/services/participants"
import { subscribeRoomUpdates } from "@/server/redis/pubsub"
import { getRoomStateStore } from "@/server/redis/state-store"
import {
  getSocketMeta,
  getSocketsForRoom,
  removeSocket,
} from "@/server/ws/registry"
import { shouldSkipDuplicateRequest } from "@/server/ws/request-dedupe"
import { attachWebSocketTransport, getLastPongMap } from "@/server/ws/transport"
import { wsEnvelopeSchema } from "@/zod/schemas"
import type { RoomState, WsEnvelope } from "@/zod/types"
import type { Server as HttpServer } from "node:http"
import type { WebSocket } from "ws"
import { roomMessageHandlers } from "./handlers/index"
import { handleRoomJoin } from "./handlers/join"
import { transferOwnershipIfNeeded } from "./services/ownership"
import { sanitizeRoomStateForClient } from "./services/room-security"

function nextMonotonicMs(previous: number, next: number) {
  return Math.max(previous + 1, next)
}

function broadcastRoomStateLocal(roomId: string, state: unknown) {
  const payload = sanitizeRoomStateForClient(state as RoomState)
  const event: WsEnvelope<"room:state", RoomState> = {
    type: "room:state",
    payload,
  }
  const raw = JSON.stringify(event)
  for (const client of getSocketsForRoom(roomId)) {
    if (client.readyState === client.OPEN) {
      client.send(raw)
    }
  }
}

export async function createRealtimeServer(server: HttpServer) {
  const store = await getRoomStateStore()
  wirePubSubFanOut()
  attachWebSocketTransport(server, (ws) => {
    setupWebSocketConnection(ws, store)
  })
}

function wirePubSubFanOut() {
  void subscribeRoomUpdates((roomId, state) => {
    broadcastRoomStateLocal(roomId, state)
  })
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
    if (meta.presenceTracked) {
      await store.removeWsConnectionRef(meta.roomId, meta.userId)
    }

    await store.updateRoom(meta.roomId, async (state) => {
      if (!state) {
        return null
      }
      const activeUsers = await store.getWsPresenceUserIds(meta.roomId)
      if (activeUsers.size === 0) {
        await store.delete(meta.roomId)
        clearAllRoomPrunes(meta.roomId)
        return null
      }
      const stillActive = activeUsers.has(meta.userId)
      if (!stillActive) {
        let didMutate = false
        const now = Date.now()
        const participant = state.participants[meta.userId]
        if (participant) {
          participant.connected = false
          participant.disconnectedAt = now
          participant.lastSeenAt = now
          participant.localPlayback.updatedAt = now
          didMutate = true
        }

        let invalidatedCurrent = false
        for (const item of state.playlist) {
          if (item.sourceKind !== "local_file") continue
          if (!item.localOriginUserId || item.localOriginUserId !== meta.userId)
            continue
          if (item.blockedReason === "local_owner_offline") continue

          item.ingestStatus = "error"
          item.ingestError =
            "Local file owner went offline. Re-add the file to resume."
          item.blockedReason = "local_owner_offline"
          didMutate = true

          if (state.playlist[state.currentIndex]?.id === item.id) {
            invalidatedCurrent = true
          }
        }

        if (invalidatedCurrent && !state.playback.paused) {
          state.playback.paused = true
          state.playback.serverNowMs = nextMonotonicMs(
            state.playback.serverNowMs,
            now,
          )
          didMutate = true
        }

        await deleteLocalMediaEntriesForOwner(meta.roomId, meta.userId)

        applyOfflinePruning(state)
        if (transferOwnershipIfNeeded(state, "disconnect")) {
          didMutate = true
        }
        if (participant) {
          appendActionLog(state, {
            roomId: meta.roomId,
            actorUserId: meta.userId,
            actorUsername: participant.username,
            action: "participant:disconnected",
            payload: {},
          })
        }
        if (didMutate) {
          state.updatedAt = now
        }
        schedulePrune(meta.roomId, meta.userId, store)
        return state
      }
      return null
    })
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
