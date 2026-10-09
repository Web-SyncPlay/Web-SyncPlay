import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import { destroyRoom } from "@/server/realtime/services/disconnect"
import type { RoomStateStorePort } from "@/server/realtime/ports"
import { transferOwnershipIfNeeded } from "./ownership"
import {
  pruneOfflineParticipants,
  reconcileParticipantsConnectivity,
} from "./participants"
import { applyRoomStateRepair } from "./room-state-repair"
import { bumpRoomRevisions } from "./timeline"

/**
 * Background sweep: sync presence, prune offline participants past grace,
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
    /** Destroy after WATCH commit — never DEL room keys inside mutate. */
    let pendingDestroy = false

    const written = await store.updateRoom(roomId, async (current) => {
      lastPruned = 0
      pendingDestroy = false
      if (!current) {
        return null
      }

      const repairFindings = applyRoomStateRepair(current)
      let didMutate = repairFindings.length > 0
      if (repairFindings.length > 0) {
        console.warn("[rooms] room state repaired during cleanup sweep", {
          roomId,
          findings: repairFindings,
        })
      }

      const activeConnections = await store.getWsPresenceUserIds(roomId)
      const recon = reconcileParticipantsConnectivity(
        current,
        activeConnections,
      )
      didMutate =
        didMutate ||
        recon.disconnecting.length > 0 ||
        recon.reconnecting.length > 0

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
        pendingDestroy = true
        // Abort write; destroyRoom runs after WATCH is released.
        return null
      }

      if (!didMutate) {
        return null
      }

      current.updatedAt = Date.now()
      bumpRoomRevisions(current)
      return current
    })

    if (pendingDestroy) {
      await destroyRoom(store, roomId)
      removedRooms += 1
    }

    if (written) {
      bus.markSnapshotDirty(roomId)
    }

    removedParticipants += lastPruned
  }

  return {
    scannedRooms: roomIds.length,
    removedRooms,
    removedParticipants,
  }
}
