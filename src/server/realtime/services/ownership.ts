import { appendActionLog } from "@/server/log"
import type { ParticipantState, RoomState } from "@/zod/types"

type TransferReason = "disconnect" | "cleanup" | "join"

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
  if (owner?.connected) {
    return false
  }

  const connectedParticipants = Object.values(state.participants).filter(
    (participant) => participant.connected,
  )
  if (connectedParticipants.length === 0) {
    return false
  }

  const nextOwner =
    pickNextOwner(connectedParticipants, "moderator") ??
    pickNextOwner(connectedParticipants, "guest")
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
