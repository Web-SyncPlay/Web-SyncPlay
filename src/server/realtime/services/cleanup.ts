import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import { destroyRoom } from "@/server/realtime/services/disconnect"
import type { RoomStateStorePort } from "@/server/realtime/ports"
import { transferOwnershipIfNeeded } from "./ownership"
import {
  pruneOfflineParticipants,
  reconcileParticipantsConnectivity,
} from "./participants"
import { bumpRoomRevisions } from "./timeline"

/**
 * Ops cleanup: sync presence, prune offline participants past grace,
 * transfer ownership, delete empty rooms.
 */
export async function cleanupInactiveRooms(store: RoomStateStorePort): Promise<{
  scannedRooms: number
  removedRooms: number
  removedParticipants: number
}> {
  const roomIds = await store.listRoomIds()
  let removedRooms = 0
  let removedParticipants = 0
  const bus = getRoomBroadcastBus()
  bus.attachStore(store)

  for (const roomId of roomIds) {
    let lastPruned = 0
    let lastDeleted = false

    const written = await store.updateRoom(roomId, async (current) => {
      lastPruned = 0
      lastDeleted = false
      if (!current) {
        return null
      }

      const activeConnections = await store.getWsPresenceUserIds(roomId)
      const recon = reconcileParticipantsConnectivity(
        current,
        activeConnections,
      )
      let didMutate =
        recon.disconnecting.length > 0 || recon.reconnecting.length > 0

      const prunedUserIds = pruneOfflineParticipants(current, Date.now())
      lastPruned = prunedUserIds.length
      if (prunedUserIds.length > 0) {
        didMutate = true
      }

      if (transferOwnershipIfNeeded(current, "cleanup")) {
        didMutate = true
      }

      const hasConnections = activeConnections.size > 0
      const hasParticipants = Object.keys(current.participants).length > 0
      if (!hasConnections && !hasParticipants) {
        await destroyRoom(store, roomId)
        lastDeleted = true
        return null
      }

      if (!didMutate) {
        return null
      }

      current.updatedAt = Date.now()
      bumpRoomRevisions(current)
      return current
    })

    if (written) {
      bus.markSnapshotDirty(roomId)
    }

    if (lastDeleted) {
      removedRooms += 1
    }
    removedParticipants += lastPruned
  }

  return {
    scannedRooms: roomIds.length,
    removedRooms,
    removedParticipants,
  }
}
