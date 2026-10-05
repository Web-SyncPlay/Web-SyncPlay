import { normalizeRole } from "@/lib/room-utils"
import type { ParticipantState, RoomState, SessionKind } from "@/zod/types"

export function hasPlaybackAndPlaylistControl(
  state: RoomState,
  userId: string,
) {
  const participant = state.participants[userId]
  if (!participant) {
    return false
  }

  const role = normalizeRole(participant.role as ParticipantState["role"])
  return role === "owner" || role === "moderator"
}

export function canControlFromConnectionContext(
  state: RoomState,
  userId: string,
  context: {
    isControlSession: boolean
    controlAuthorized: boolean
    sessionKind?: SessionKind
  },
) {
  // Player embeds are display surfaces — no room mutations.
  if (context.sessionKind === "player") {
    return false
  }

  if (!hasPlaybackAndPlaylistControl(state, userId)) {
    return false
  }

  if (!context.isControlSession) {
    return true
  }

  return context.controlAuthorized
}

export function normalizeParticipantRoles(state: RoomState): void {
  for (const participant of Object.values(state.participants)) {
    participant.role = normalizeRole(
      participant.role as ParticipantState["role"],
    )
  }
}
