import type { RoomStateStorePort } from "@/server/realtime/ports"
import { getCommandClient } from "@/server/redis/client"
import { keys } from "@/server/redis/keys"
import type { RoomState } from "@/zod/types"

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
 * Pending members whose grace key expired — remove disconnected participants.
 * Safe across instances; room update WATCH serializes mutations.
 */
export async function processDuePrunes(
  store: RoomStateStorePort,
): Promise<number> {
  try {
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

      const next = await store.updateRoom(parsed.roomId, (state) => {
        if (!state) return null
        const participant = state.participants[parsed.userId]
        if (!participant || participant.connected) {
          return state
        }
        delete state.participants[parsed.userId]
        state.updatedAt = Date.now()
        return state
      })

      await client.sRem(keys.roomPendingPrunes(), member)
      mutated = true
      if (next && !next.participants[parsed.userId]) {
        pruned += 1
      }
    }

    if (mutated || members.length > 0) {
      await refreshPendingPrunesTtl(client)
    }

    return pruned
  } catch (error) {
    console.warn("[participants] processDuePrunes redis failed", error)
    return 0
  }
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

    if (nowMs - disconnectedAt < PARTICIPANT_PRUNE_MS) {
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

export function applyOfflinePruning(state: RoomState) {
  const nowMs = Date.now()
  const prunedUserIds = pruneOfflineParticipants(state, nowMs)
  if (prunedUserIds.length === 0) {
    return
  }

  for (const userId of prunedUserIds) {
    void clearPrune(state.roomId, userId)
  }
  state.updatedAt = nowMs
}
