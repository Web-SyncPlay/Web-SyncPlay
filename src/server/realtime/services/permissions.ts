import { normalizeRole } from "@/lib/room-utils"
import type {
  ParticipantState,
  RoomRole,
  RoomState,
  SessionKind,
} from "@/zod/types"

export type ConnectionAuthContext = {
  isControlSession: boolean
  controlAuthorized: boolean
  sessionKind?: SessionKind
}

export type SessionCapabilities = {
  canControlPlayback: boolean
  canManagePlaylist: boolean
  canManageRoomSecurity: boolean
  isControlSession: boolean
  controlAuthorized: boolean
  sessionKind: SessionKind
}

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

function passesSessionGate(context: ConnectionAuthContext) {
  if (context.sessionKind === "player") {
    return false
  }
  if (!context.isControlSession) {
    return true
  }
  return context.controlAuthorized
}

export function canControlFromConnectionContext(
  state: RoomState,
  userId: string,
  context: ConnectionAuthContext,
) {
  if (!passesSessionGate(context)) {
    return false
  }
  return hasPlaybackAndPlaylistControl(state, userId)
}

/** Owner-only room security (password) — same session gate as playback control. */
export function canManageRoomSecurityFromConnectionContext(
  state: RoomState,
  userId: string,
  context: ConnectionAuthContext,
) {
  if (!passesSessionGate(context)) {
    return false
  }
  return state.ownerId === userId
}

export function computeSessionCapabilities(params: {
  role: RoomRole
  sessionKind: SessionKind
  isControlSession: boolean
  controlAuthorized: boolean
}): SessionCapabilities {
  const { role, sessionKind, isControlSession, controlAuthorized } = params
  const canControlByRole = role === "owner" || role === "moderator"
  const playerBlocked = sessionKind === "player"
  const sessionOk =
    !playerBlocked && (!isControlSession || controlAuthorized)
  const canMutate = sessionOk && canControlByRole
  const canManageRoomSecurity = sessionOk && role === "owner"

  return {
    canControlPlayback: canMutate,
    canManagePlaylist: canMutate,
    canManageRoomSecurity,
    isControlSession,
    controlAuthorized,
    sessionKind,
  }
}

export function normalizeParticipantRoles(state: RoomState): void {
  for (const participant of Object.values(state.participants)) {
    participant.role = normalizeRole(
      participant.role as ParticipantState["role"],
    )
  }
}
