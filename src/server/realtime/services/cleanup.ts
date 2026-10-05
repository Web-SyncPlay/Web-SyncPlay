import type { RoomStateStorePort } from "@/server/realtime/ports"
import { transferOwnershipIfNeeded } from "./ownership"
import { clearAllRoomPrunes } from "./participants"

export async function cleanupInactiveRooms(store: RoomStateStorePort): Promise<{
  scannedRooms: number
  removedRooms: number
  removedParticipants: number
}> {
  const roomIds = await store.listRoomIds()
  let removedRooms = 0
  let removedParticipants = 0

  for (const roomId of roomIds) {
    let lastPruned = 0
    let lastDeleted = false

    await store.updateRoom(roomId, async (current) => {
      lastPruned = 0
      lastDeleted = false
      if (!current) {
        return null
      }

      const activeConnections = await store.getWsPresenceUserIds(roomId)
      let didMutate = false
      for (const participant of Object.values(current.participants)) {
        const isConnected = activeConnections.has(participant.userId)
        if (participant.connected !== isConnected) {
          didMutate = true
        }
        participant.connected = isConnected
        if (isConnected) {
          participant.disconnectedAt = undefined
        } else if (!participant.disconnectedAt) {
          participant.disconnectedAt = Date.now()
          participant.lastSeenAt = Date.now()
        }
      }

      const prunedUserIds: string[] = []
      for (const [userId, participant] of Object.entries(
        current.participants,
      )) {
        if (participant.connected) continue
        delete current.participants[userId]
        prunedUserIds.push(userId)
        didMutate = true
      }

      lastPruned = prunedUserIds.length
      if (transferOwnershipIfNeeded(current, "cleanup")) {
        didMutate = true
      }

      const hasConnections = activeConnections.size > 0
      const hasParticipants = Object.keys(current.participants).length > 0
      if (!hasConnections && !hasParticipants) {
        await store.delete(roomId)
        clearAllRoomPrunes(roomId)
        lastDeleted = true
        return null
      }

      if (!didMutate) {
        return null
      }

      current.updatedAt = Date.now()
      return current
    })

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
