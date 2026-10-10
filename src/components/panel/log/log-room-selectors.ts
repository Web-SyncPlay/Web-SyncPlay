import type { ActionLogEntry, RoomState } from "@/contracts/types"

/**
 * Narrow log-panel inputs. Presence lastSeen/connected churn does not change
 * actionLog identity or usernames; only those fields drive log UI.
 */
export type LogShellSlice = {
  actionLog: ActionLogEntry[]
  /** userId → display name; content-stable across presence ticks. */
  participantUsernames: Record<string, string>
}

export function selectParticipantUsernames(
  roomState: RoomState,
): Record<string, string> {
  const names: Record<string, string> = {}
  for (const [userId, participant] of Object.entries(roomState.participants)) {
    names[userId] = participant.username
  }
  return names
}

export function selectLogShellSlice(roomState: RoomState): LogShellSlice {
  return {
    actionLog: roomState.actionLog,
    participantUsernames: selectParticipantUsernames(roomState),
  }
}

/** Filter options for LogFilters; mirrors shared getLogUsers over the slice. */
export function selectLogFilterUsers(
  slice: LogShellSlice,
): Array<{ id: string; label: string }> {
  const unique = new Map<string, string>()
  for (const log of slice.actionLog) {
    const label =
      log.actorUsername ??
      slice.participantUsernames[log.actorUserId] ??
      log.actorUserId
    unique.set(log.actorUserId, label)
  }
  return Array.from(unique.entries()).map(([id, label]) => ({ id, label }))
}

export function participantUsernamesEqual(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false
  }
  return true
}

/** True when two log shell slices are equal for memo isolation. */
export function logShellSlicesEqual(
  a: LogShellSlice,
  b: LogShellSlice,
): boolean {
  return (
    a.actionLog === b.actionLog &&
    participantUsernamesEqual(a.participantUsernames, b.participantUsernames)
  )
}
