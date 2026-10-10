import type { ClientRoomState, ParticipantState } from "@/contracts/types"

/**
 * Users panel intentionally tracks presence (connected / lastSeen) for online
 * badges and relative-seen tooltips. This slice is not memo-isolated from
 * presence churn — it exists so callers select explicitly rather than
 * threading full roomState into list rows by accident.
 */
export type UsersPanelSlice = {
  participants: Record<string, ParticipantState>
}

export function selectUsersPanelSlice(
  roomState: ClientRoomState,
): UsersPanelSlice {
  return { participants: roomState.participants }
}
