import type { RoomStateStorePort } from "@/server/ports"
import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import { destroyRoom } from "@/server/realtime/services/disconnect"
import {
  clearRoomEmptyMarker,
  confirmEmptyRoomDestroyAllowed,
  noteEmptyPresenceAndShouldDestroy,
} from "@/server/realtime/services/empty-room"
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
    let disconnectingUserIds: string[] = []
    let reconnectingUserIds: string[] = []
    let pastGraceUserIds: string[] = []

    // Presence I/O outside WATCH: read snapshot, then reconcile side effects.
    const activeConnections = await store.readWsPresenceUserIds(roomId)
    await store.reconcilePresenceRefs(roomId)
    const hasConnections = activeConnections.size > 0

    const written = await store.updateRoom(roomId, async (current) => {
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

    if (hasConnections) {
      await clearRoomEmptyMarker(roomId)
    } else if (await noteEmptyPresenceAndShouldDestroy(roomId)) {
      // Re-check presence + emptyAt so a concurrent join cannot lose the room.
      const allowed = await confirmEmptyRoomDestroyAllowed(
        roomId,
        async () => (await store.readWsPresenceUserIds(roomId)).size > 0,
      )
      if (allowed) {
        // Never DEL room keys inside WATCH — destroy after commit/presence I/O.
        await destroyRoom(store, roomId)
        removedRooms += 1
        continue
      }
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
