import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import { applyUserWentOffline } from "@/server/realtime/services/disconnect"
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
  const activeUsers = await options.store.getWsPresenceUserIds(options.roomId)
  if (!activeUsers.has(options.userId)) {
    const next = await options.store.updateRoom(options.roomId, async (state) => {
      if (!state) return null
      const stillActive = await options.store.getWsPresenceUserIds(
        options.roomId,
      )
      if (stillActive.has(options.userId)) return null
      if (!applyUserWentOffline(state, options.roomId, options.userId)) {
        return null
      }
      await schedulePrune(options.roomId, options.userId)
      bumpRoomRevisions(state)
      return state
    })
    if (next) {
      const bus = getRoomBroadcastBus()
      bus.attachStore(options.store)
      const now = Date.now()
      const offlinePresence = {
        connected: false as const,
        lastSeenAt: now,
        disconnectedAt: now,
        localPlayback: next.participants[options.userId]?.localPlayback,
      }
      await options.store.mergePresenceData(
        options.roomId,
        options.userId,
        offlinePresence,
      )
      bus.markPresenceDirty(options.roomId, options.userId, offlinePresence)
      bus.markSnapshotDirty(options.roomId)
    }
  }

  sendEnvelope(options.ws, {
    type: "room:join:rejected",
    requestId: options.requestId,
    payload: { reason: "connection_closed" },
  })
}
