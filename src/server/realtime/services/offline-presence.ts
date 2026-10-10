import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import type { RoomStateStorePort } from "@/server/ports"
import type { RoomState } from "@/contracts/types"

/**
 * Persist + fan-out offline presence after a successful room write that marked
 * the user disconnected. Shared by disconnect and join-abort paths.
 */
export async function publishUserOfflinePresence(
  store: RoomStateStorePort,
  roomId: string,
  userId: string,
  state: RoomState,
): Promise<void> {
  const bus = getRoomBroadcastBus()
  bus.attachStore(store)
  const now = Date.now()
  const offlinePresence = {
    connected: false as const,
    lastSeenAt: now,
    disconnectedAt: now,
    localPlayback: state.participants[userId]?.localPlayback,
  }
  await store.mergePresenceData(roomId, userId, offlinePresence)
  bus.markPresenceDirty(roomId, userId, offlinePresence)
}
