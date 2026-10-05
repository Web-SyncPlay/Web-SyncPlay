import {
  installShutdownOnce,
  registerShutdownHandler,
} from "@/server/lifecycle"
import type { RoomStateStorePort } from "@/server/realtime/ports"
import type { RoomState } from "@/zod/types"

const participantPruneMs = Number(process.env.PARTICIPANT_PRUNE_MS ?? 60_000)

let pruneShutdownRegistered = false

function ensurePruneShutdownRegistered() {
  if (pruneShutdownRegistered) return
  pruneShutdownRegistered = true
  installShutdownOnce()
  registerShutdownHandler(async () => {
    const timers = getPruneTimers()
    for (const t of timers.values()) {
      clearTimeout(t)
    }
    timers.clear()
  })
}

type PruneTimers = Map<string, ReturnType<typeof setTimeout>>

function getPruneTimers(): PruneTimers {
  const g = globalThis as typeof globalThis & {
    __webSyncPlayPruneTimers?: PruneTimers
  }
  g.__webSyncPlayPruneTimers ??= new Map()
  return g.__webSyncPlayPruneTimers
}

export function pruneKey(roomId: string, userId: string) {
  return `${roomId}:${userId}`
}

export function clearAllRoomPrunes(roomId: string) {
  const pruneTimers = getPruneTimers()
  for (const [key, timer] of pruneTimers.entries()) {
    if (!key.startsWith(`${roomId}:`)) continue
    clearTimeout(timer)
    pruneTimers.delete(key)
  }
}

export function clearPrune(roomId: string, userId: string) {
  const pruneTimers = getPruneTimers()
  const key = pruneKey(roomId, userId)
  const existing = pruneTimers.get(key)
  if (existing) {
    clearTimeout(existing)
    pruneTimers.delete(key)
  }
}

export function schedulePrune(
  roomId: string,
  userId: string,
  store: RoomStateStorePort,
) {
  ensurePruneShutdownRegistered()
  clearPrune(roomId, userId)
  const pruneTimers = getPruneTimers()
  const key = pruneKey(roomId, userId)
  const timer = setTimeout(() => {
    pruneTimers.delete(key)
    void store.updateRoom(roomId, (state) => {
      if (!state) {
        return null
      }
      const participant = state.participants[userId]
      if (!participant || participant.connected) {
        return state
      }
      delete state.participants[userId]
      state.updatedAt = Date.now()
      return state
    })
  }, participantPruneMs)
  pruneTimers.set(key, timer)
}

export function pruneOfflineParticipants(state: RoomState, nowMs: number) {
  const removedUserIds: string[] = []
  for (const [userId, participant] of Object.entries(state.participants)) {
    if (participant.connected) {
      continue
    }

    const disconnectedAt =
      participant.disconnectedAt ?? participant.lastSeenAt ?? 0
    if (!disconnectedAt) {
      continue
    }

    if (nowMs - disconnectedAt < participantPruneMs) {
      continue
    }

    delete state.participants[userId]
    removedUserIds.push(userId)
  }

  return removedUserIds
}

export function reconcileParticipantsConnectivity(
  state: RoomState,
  activeUserIds: Set<string>,
): { disconnecting: string[]; reconnecting: string[] } {
  const disconnecting: string[] = []
  const reconnecting: string[] = []
  for (const participant of Object.values(state.participants)) {
    if (!participant.joinedAt) {
      participant.joinedAt =
        participant.connectedAt ?? participant.lastSeenAt ?? Date.now()
    }
    const isActive = activeUserIds.has(participant.userId)
    if (participant.connected && !isActive) {
      participant.connected = false
      participant.disconnectedAt = Date.now()
      participant.lastSeenAt = Date.now()
      disconnecting.push(participant.userId)
    } else if (!participant.connected && isActive) {
      participant.connected = true
      participant.disconnectedAt = undefined
      participant.lastSeenAt = Date.now()
      reconnecting.push(participant.userId)
    }
  }
  return { disconnecting, reconnecting }
}

export function applyOfflinePruning(state: RoomState) {
  const nowMs = Date.now()
  const prunedUserIds = pruneOfflineParticipants(state, nowMs)
  if (prunedUserIds.length === 0) {
    return
  }

  for (const userId of prunedUserIds) {
    clearPrune(state.roomId, userId)
  }
  state.updatedAt = nowMs
}
