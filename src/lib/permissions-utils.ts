import type { RoomRole } from "@/zod/types"

/** Owner or moderator — shared by playback and playlist mutation gates. */
export function canMutateByRole(role?: RoomRole): boolean {
  return role === "owner" || role === "moderator"
}

export function isOwner(role?: RoomRole): boolean {
  return role === "owner"
}

export function canControlPlayback(role?: RoomRole): boolean {
  return canMutateByRole(role)
}

export function canControlPlaylist(role?: RoomRole): boolean {
  return canMutateByRole(role)
}

/**
 * Control embeds need a minted token (or legacy identity match).
 * Non-control sessions are treated as authorized for local UI gating.
 */
export function isClientControlAuthorized(caps: {
  isControlSession: boolean
  controlAuthorized: boolean
}): boolean {
  return !caps.isControlSession || caps.controlAuthorized
}

/** Role + control-session gate used by room/player embed UIs. */
export function canMutateFromClientSession(input: {
  role?: RoomRole
  isControlSession: boolean
  controlAuthorized: boolean
}): boolean {
  return canMutateByRole(input.role) && isClientControlAuthorized(input)
}
