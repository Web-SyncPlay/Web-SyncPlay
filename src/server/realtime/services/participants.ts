import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import type { RoomStateStorePort } from "@/server/realtime/ports"
import { getCommandClient } from "@/server/redis/client"
import { keys } from "@/server/redis/keys"
import type { RoomState } from "@/contracts/types"
import { transferOwnershipIfNeeded } from "./ownership"
import { bumpRoomRevisions } from "./timeline"

export const PARTICIPANT_PRUNE_MS = 60_000
const PARTICIPANT_PRUNE_SECONDS = Math.ceil(PARTICIPANT_PRUNE_MS / 1000)
/** Keep the pending-prunes index at least as long as a grace period, with slack. */
const PENDING_PRUNES_TTL_SECONDS = PARTICIPANT_PRUNE_SECONDS * 2

function encodePruneMember(roomId: string, userId: string) {
  return `${roomId}\t${userId}`
}

export function parsePruneMember(
  member: string,
): { roomId: string; userId: string } | null {
  const idx = member.indexOf("\t")
  if (idx <= 0 || idx === member.length - 1) return null
  return {
    roomId: member.slice(0, idx),
    userId: member.slice(idx + 1),
  }
}

export function pruneKey(roomId: string, userId: string) {
  return `${roomId}:${userId}`
}

async function refreshPendingPrunesTtl(
  client: Awaited<ReturnType<typeof getCommandClient>>,
) {
  await client.expire(keys.roomPendingPrunes(), PENDING_PRUNES_TTL_SECONDS)
}

export async function clearAllRoomPrunes(roomId: string) {
  try {
    const client = await getCommandClient()
    const members = await client.sMembers(keys.roomPendingPrunes())
    const prefix = `${roomId}\t`
    const toRemove: string[] = []
    const pruneKeys: string[] = []

    for (const member of members) {
      if (!member.startsWith(prefix)) continue
      toRemove.push(member)
      const parsed = parsePruneMember(member)
      if (parsed) {
        pruneKeys.push(keys.roomParticipantPrune(parsed.roomId, parsed.userId))
      }
    }

    if (pruneKeys.length > 0) {
      await client.del(pruneKeys)
    }
    if (toRemove.length > 0) {
      await client.sRem(keys.roomPendingPrunes(), toRemove)
    }
    await refreshPendingPrunesTtl(client)
  } catch (error) {
    console.warn("[participants] clearAllRoomPrunes redis failed", error)
  }
}

export async function clearPrune(roomId: string, userId: string) {
  try {
    const client = await getCommandClient()
    await client.del(keys.roomParticipantPrune(roomId, userId))
    await client.sRem(
      keys.roomPendingPrunes(),
      encodePruneMember(roomId, userId),
    )
    await refreshPendingPrunesTtl(client)
  } catch (error) {
    console.warn("[participants] clearPrune redis failed", error)
  }
}

export async function schedulePrune(roomId: string, userId: string) {
  try {
    const client = await getCommandClient()
    await client.set(keys.roomParticipantPrune(roomId, userId), "1", {
      EX: PARTICIPANT_PRUNE_SECONDS,
    })
    await client.sAdd(
      keys.roomPendingPrunes(),
      encodePruneMember(roomId, userId),
    )
    await refreshPendingPrunesTtl(client)
  } catch (error) {
    console.warn("[participants] schedulePrune redis failed", error)
  }
}

/**
 * Index a participant as already past grace (no grace SET). Cleanup uses this for
 * disconnected users whose disconnectedAt already exceeds {@link PARTICIPANT_PRUNE_MS}
 * so they enter the Redis authoritative path immediately.
 */
export async function schedulePruneDue(roomId: string, userId: string) {
  try {
    const client = await getCommandClient()
    await client.del(keys.roomParticipantPrune(roomId, userId))
    await client.sAdd(
      keys.roomPendingPrunes(),
      encodePruneMember(roomId, userId),
    )
    await refreshPendingPrunesTtl(client)
  } catch (error) {
    console.warn("[participants] schedulePruneDue redis failed", error)
  }
}

/**
 * Collect disconnected participants whose in-memory grace has elapsed.
 * Used by cleanup to enqueue them on the Redis prune index.
 */
export function listParticipantsPastPruneGrace(
  state: RoomState,
  nowMs: number,
): string[] {
  const due: string[] = []
  for (const [userId, participant] of Object.entries(state.participants)) {
    if (participant.connected) continue
    const disconnectedAt =
      participant.disconnectedAt ?? participant.lastSeenAt ?? 0
    if (!disconnectedAt) continue
    if (nowMs - disconnectedAt < PARTICIPANT_PRUNE_MS) continue
    due.push(userId)
  }
  return due
}

/**
 * In-memory time-based prune. Used only as a fallback inside {@link processDuePrunes}
 * when Redis is unavailable.
 */
export function pruneOfflineParticipants(state: RoomState, nowMs: number) {
  const removedUserIds: string[] = []
  for (const userId of listParticipantsPastPruneGrace(state, nowMs)) {
    delete state.participants[userId]
    removedUserIds.push(userId)
  }
  return removedUserIds
}

async function removeDisconnectedParticipant(
  store: RoomStateStorePort,
  roomId: string,
  userId: string,
): Promise<boolean> {
  const next = await store.updateRoom(roomId, (state) => {
    if (!state) return null
    const participant = state.participants[userId]
    // No-op: avoid spurious Redis SET / WATCH contention.
    if (!participant || participant.connected) {
      return null
    }
    delete state.participants[userId]
    // R4: pruning the owner must transfer ownership and bump revisions.
    transferOwnershipIfNeeded(state, "prune")
    bumpRoomRevisions(state)
    state.updatedAt = Date.now()
    return state
  })

  if (next && !next.participants[userId]) {
    getRoomBroadcastBus().markSnapshotDirty(roomId)
    return true
  }
  return false
}

async function pruneFromRedisIndex(store: RoomStateStorePort): Promise<number> {
  const client = await getCommandClient()
  const members = await client.sMembers(keys.roomPendingPrunes())
  let pruned = 0
  let mutated = false

  for (const member of members) {
    const parsed = parsePruneMember(member)
    if (!parsed) {
      await client.sRem(keys.roomPendingPrunes(), member)
      mutated = true
      continue
    }

    const graceKey = keys.roomParticipantPrune(parsed.roomId, parsed.userId)
    const stillGrace = await client.get(graceKey)
    if (stillGrace) continue

    const didPrune = await removeDisconnectedParticipant(
      store,
      parsed.roomId,
      parsed.userId,
    )
    await client.sRem(keys.roomPendingPrunes(), member)
    mutated = true
    if (didPrune) {
      pruned += 1
    }
  }

  if (mutated || members.length > 0) {
    await refreshPendingPrunesTtl(client)
  }

  return pruned
}

/**
 * Fallback when Redis is down: scan rooms and prune by disconnectedAt only.
 */
async function pruneByDisconnectedAtFallback(
  store: RoomStateStorePort,
): Promise<number> {
  const roomIds = await store.listRoomIds()
  const nowMs = Date.now()
  let pruned = 0

  for (const roomId of roomIds) {
    let removedCount = 0
    const next = await store.updateRoom(roomId, (state) => {
      if (!state) return null
      const removed = pruneOfflineParticipants(state, nowMs)
      if (removed.length === 0) return null
      removedCount = removed.length
      transferOwnershipIfNeeded(state, "prune")
      bumpRoomRevisions(state)
      state.updatedAt = nowMs
      return state
    })
    if (next && removedCount > 0) {
      pruned += removedCount
      getRoomBroadcastBus().markSnapshotDirty(roomId)
    }
  }

  return pruned
}

/**
 * Pending members whose grace key expired — remove disconnected participants.
 * Redis pending-prunes is the sole cluster-authoritative path. In-memory
 * disconnectedAt pruning runs only when Redis is unavailable.
 * Safe across instances; room update WATCH serializes mutations.
 */
export async function processDuePrunes(
  store: RoomStateStorePort,
): Promise<number> {
  try {
    return await pruneFromRedisIndex(store)
  } catch (error) {
    console.warn(
      "[participants] processDuePrunes redis failed; falling back to in-memory prune",
      error,
    )
    try {
      return await pruneByDisconnectedAtFallback(store)
    } catch (fallbackError) {
      console.warn(
        "[participants] processDuePrunes in-memory fallback failed",
        fallbackError,
      )
      return 0
    }
  }
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
      const nowMs = Date.now()
      participant.connected = false
      participant.disconnectedAt = nowMs
      participant.lastSeenAt = nowMs
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
