import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import { destroyRoom } from "@/server/realtime/services/disconnect"
import type { RoomStateStorePort } from "@/server/ports"
import { transferOwnershipIfNeeded } from "./ownership"
import {
  clearPrune,
  listParticipantsPastPruneGrace,
  processDuePrunes,
  reconcileParticipantsConnectivity,
  schedulePrune,
  schedulePruneDue,
} from "./participants"
import { applyRoomStateRepair } from "./room-state-repair"
import { bumpRoomRevisions } from "./timeline"

/**
 * Background sweep: sync presence, enqueue Redis prunes for offline users,
 * transfer ownership, delete empty rooms. Actual participant removal goes
 * through {@link processDuePrunes} (Redis authoritative path).
 */
export async function cleanupInactiveRooms(store: RoomStateStorePort): Promise<{
  scannedRooms: number
  removedRooms: number
  removedParticipants: number
}> {
  const roomIds = await store.listRoomIds()
  let removedRooms = 0
  const bus = getRoomBroadcastBus()
  bus.attachStore(store)

  for (const roomId of roomIds) {
    /** Destroy after WATCH commit — never DEL room keys inside mutate. */
    let pendingDestroy = false
    let disconnectingUserIds: string[] = []
    let reconnectingUserIds: string[] = []
    let pastGraceUserIds: string[] = []

    const written = await store.updateRoom(roomId, async (current) => {
      pendingDestroy = false
      disconnectingUserIds = []
      reconnectingUserIds = []
      pastGraceUserIds = []
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
      disconnectingUserIds = recon.disconnecting
      reconnectingUserIds = recon.reconnecting
      didMutate =
        didMutate ||
        recon.disconnecting.length > 0 ||
        recon.reconnecting.length > 0

      // Enqueue on Redis post-commit; do not prune inline (bypasses index).
      pastGraceUserIds = listParticipantsPastPruneGrace(current, Date.now())

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

    // Post-commit Redis prune index (same H3 pattern as mutate-room).
    for (const uid of reconnectingUserIds) {
      await clearPrune(roomId, uid)
    }
    for (const uid of disconnectingUserIds) {
      await schedulePrune(roomId, uid)
    }
    for (const uid of pastGraceUserIds) {
      // Already past grace — index as immediately due (no new grace window).
      if (!disconnectingUserIds.includes(uid)) {
        await schedulePruneDue(roomId, uid)
      }
    }

    if (pendingDestroy) {
      await destroyRoom(store, roomId)
      removedRooms += 1
    }

    if (written) {
      bus.markSnapshotDirty(roomId)
    }
  }

  const removedParticipants = await processDuePrunes(store)

  return {
    scannedRooms: roomIds.length,
    removedRooms,
    removedParticipants,
  }
}
