import type { ParticipantState, RoomState } from "@/contracts/types"
import { appendActionLog } from "@/server/log"

type TransferReason = "disconnect" | "cleanup" | "join" | "prune"

function participantSortKey(participant: ParticipantState) {
  return (
    participant.joinedAt ??
    participant.connectedAt ??
    participant.lastSeenAt ??
    Number.MAX_SAFE_INTEGER
  )
}

function pickNextOwner(
  participants: ParticipantState[],
  role: ParticipantState["role"],
): ParticipantState | undefined {
  let best: ParticipantState | undefined
  let bestKey = Number.POSITIVE_INFINITY
  for (const participant of participants) {
    if (participant.role !== role) continue
    const key = participantSortKey(participant)
    if (key < bestKey) {
      best = participant
      bestKey = key
    }
  }
  return best
}

export function transferOwnershipIfNeeded(
  state: RoomState,
  reason: TransferReason,
): boolean {
  const owner = state.participants[state.ownerId]

  // Brief disconnects (HMR remount, socket blip) must not demote the owner.
  // - disconnect: never transfer here (caller should omit); kept as no-op.
  // - join: only heal a missing ownerId; a disconnected owner may still return
  //   within prune grace.
  // - prune / cleanup: transfer when owner is missing or still disconnected.
  if (reason === "disconnect") {
    return false
  }
  if (reason === "join") {
    if (owner) return false
  } else if (owner?.connected) {
    return false
  }

  const pool = Object.values(state.participants)
  // Prefer connected peers; on prune, fall back to any remaining participant so
  // ownerId cannot point at a deleted user.
  const connectedParticipants = pool.filter((p) => p.connected)
  const candidates =
    connectedParticipants.length > 0
      ? connectedParticipants
      : reason === "prune"
        ? pool
        : []
  if (candidates.length === 0) {
    return false
  }

  const nextOwner =
    pickNextOwner(candidates, "moderator") ??
    pickNextOwner(candidates, "guest") ??
    (reason === "prune" ? pickNextOwner(candidates, "owner") : undefined)
  if (!nextOwner) {
    return false
  }

  const previousOwnerId = state.ownerId
  state.ownerId = nextOwner.userId
  nextOwner.role = "owner"

  const previousOwner = state.participants[previousOwnerId]
  if (previousOwner && previousOwner.userId !== nextOwner.userId) {
    previousOwner.role = "guest"
  }

  appendActionLog(state, {
    roomId: state.roomId,
    actorUserId: nextOwner.userId,
    actorUsername: nextOwner.username,
    action: "participant:owner:transferred",
    payload: {
      previousOwnerId,
      nextOwnerId: nextOwner.userId,
      reason,
    },
  })

  return true
}
