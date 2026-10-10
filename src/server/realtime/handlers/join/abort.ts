import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import { applyUserWentOffline } from "@/server/realtime/services/disconnect"
import { publishUserOfflinePresence } from "@/server/realtime/services/offline-presence"
import { schedulePrune } from "@/server/realtime/services/participants"
import { bumpRoomRevisions } from "@/server/realtime/services/timeline"
import type { RoomStateStorePort } from "@/server/ports"
import { removeSocket } from "@/server/ws/registry"
import type { WebSocket } from "ws"
import { sendEnvelope } from "./send"

/** R1/D3: roll back presence and reject when the socket died mid-join. */
export async function abortJoinAfterCommit(options: {
  ws: WebSocket
  store: RoomStateStorePort
  roomId: string
  userId: string
  requestId?: string
  /** Only decrement when this join added a presence ref (avoid wiping multi-tab). */
  didAddPresence: boolean
}) {
  if (options.didAddPresence) {
    await options.store.removeWsConnectionRef(options.roomId, options.userId)
  }
  removeSocket(options.ws)

  // H2: room commit already wrote connected:true; compensate if no live presence remains.
  // Presence I/O outside WATCH (same pattern as cleanupInactiveRooms).
  const activeUsers = await options.store.readWsPresenceUserIds(options.roomId)
  await options.store.reconcilePresenceRefs(options.roomId)
  if (!activeUsers.has(options.userId)) {
    // Fresh read immediately before WATCH to shrink the race window without
    // HASH writes inside the mutate closure.
    const stillActive = await options.store.readWsPresenceUserIds(
      options.roomId,
    )
    if (!stillActive.has(options.userId)) {
      const next = await options.store.updateRoom(
        options.roomId,
        async (state) => {
          if (!state) return null
          if (!applyUserWentOffline(state, options.roomId, options.userId)) {
            return null
          }
          bumpRoomRevisions(state)
          return state
        },
      )
      if (next) {
        await schedulePrune(options.roomId, options.userId)
        await publishUserOfflinePresence(
          options.store,
          options.roomId,
          options.userId,
          next,
        )
        getRoomBroadcastBus().markSnapshotDirty(options.roomId)
      }
    }
  }

  sendEnvelope(options.ws, {
    type: "room:join:rejected",
    requestId: options.requestId,
    payload: { reason: "connection_closed" },
  })
}
