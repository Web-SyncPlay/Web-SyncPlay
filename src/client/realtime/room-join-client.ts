import type {
  RoomJoinRejectedReason,
  SessionCapabilities,
  SessionKind,
  WsEnvelope,
} from "@/contracts/types"

export type { RoomJoinRejectedReason, SessionCapabilities }
export type JoinRejectedReason = RoomJoinRejectedReason

export type JoinStatus =
  | "connecting"
  | "awaiting_password"
  | "joining"
  | "connected"
  | "reconnecting"
  | "media_unsupported"
  | "rate_limited"
  | "identity_mismatch"

/** Pause auto-reconnect this long after `rate_limited`. */
export const RATE_LIMITED_RECONNECT_MS = 15_000

export function createDefaultSessionCapabilities(
  sessionKind: SessionKind,
): SessionCapabilities {
  return {
    canControlPlayback: false,
    canManagePlaylist: false,
    canManageRoomSecurity: false,
    isControlSession: sessionKind === "control",
    controlAuthorized: false,
    sessionKind,
  }
}

export function normalizeSessionCapabilities(
  payload: Partial<SessionCapabilities>,
  fallbackSessionKind: SessionKind,
): SessionCapabilities {
  return {
    canControlPlayback: Boolean(payload.canControlPlayback),
    canManagePlaylist: Boolean(payload.canManagePlaylist),
    canManageRoomSecurity: Boolean(payload.canManageRoomSecurity),
    isControlSession: Boolean(payload.isControlSession),
    controlAuthorized: Boolean(payload.controlAuthorized),
    sessionKind:
      (payload.sessionKind as SessionKind | undefined) ?? fallbackSessionKind,
  }
}

export function messageForJoinRejected(reason?: JoinRejectedReason): string {
  if (reason === "media_url_unsupported") {
    return "This media URL is not supported for room creation."
  }
  if (reason === "invalid_password") {
    return "Incorrect room password. Try again."
  }
  if (reason === "rate_limited") {
    return "Too many join attempts. Try again in a moment."
  }
  if (reason === "identity_mismatch") {
    return "Your session identity does not match this connection. Refresh the page and try again."
  }
  if (reason === "connection_closed") {
    return "Connection closed during join. Reconnecting…"
  }
  return "This room requires a join password."
}

export function statusForJoinRejected(reason?: JoinRejectedReason): JoinStatus {
  if (reason === "media_url_unsupported") {
    return "media_unsupported"
  }
  if (reason === "rate_limited") {
    return "rate_limited"
  }
  if (reason === "identity_mismatch") {
    return "identity_mismatch"
  }
  if (reason === "connection_closed") {
    return "reconnecting"
  }
  return "awaiting_password"
}

/**
 * Password / identity / media failures must not auto-reconnect.
 * `rate_limited` pauses until {@link RATE_LIMITED_RECONNECT_MS}; `connection_closed` does not pause.
 */
export function shouldPauseAutoReconnect(reason?: JoinRejectedReason): boolean {
  return (
    reason === "password_required" ||
    reason === "invalid_password" ||
    reason === "rate_limited" ||
    reason === "identity_mismatch" ||
    reason === "media_url_unsupported" ||
    reason === undefined
  )
}

/** Hard stop — no cooldown resume. */
export function isTerminalJoinRejection(reason?: JoinRejectedReason): boolean {
  return reason === "media_url_unsupported" || reason === "identity_mismatch"
}

export function nextJoinStatusOnConnectAttempt(prev: JoinStatus): JoinStatus {
  return prev === "connected" ? "reconnecting" : "connecting"
}

export function buildRoomJoinEnvelope(input: {
  roomId: string
  userId: string
  userSecret: string
  username: string
  sessionKind: SessionKind
  joinPassword?: string
  controlToken?: string
  initialMediaUrl?: string
  requestId?: string
}): WsEnvelope<string, Record<string, unknown>> {
  const payload: Record<string, unknown> = {
    roomId: input.roomId,
    userId: input.userId,
    userSecret: input.userSecret,
    username: input.username,
    sessionKind: input.sessionKind,
  }
  if (input.joinPassword) {
    payload.joinPassword = input.joinPassword
  }
  if (input.controlToken) {
    payload.controlToken = input.controlToken
  }
  if (input.initialMediaUrl) {
    payload.initialMediaUrl = input.initialMediaUrl
  }
  return {
    type: "room:join",
    ...(input.requestId ? { requestId: input.requestId } : {}),
    payload,
  }
}
