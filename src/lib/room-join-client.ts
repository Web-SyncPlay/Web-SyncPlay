import type { SessionKind, WsEnvelope } from "@/zod/types"

export type SessionCapabilities = {
  canControlPlayback: boolean
  canManagePlaylist: boolean
  canManageRoomSecurity: boolean
  isControlSession: boolean
  controlAuthorized: boolean
  sessionKind: SessionKind
}

export type JoinStatus =
  | "connecting"
  | "awaiting_password"
  | "joining"
  | "connected"
  | "reconnecting"

export type JoinRejectedReason =
  | "password_required"
  | "invalid_password"
  | "rate_limited"

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

export function messageForJoinRejected(
  reason?: JoinRejectedReason,
): string {
  if (reason === "invalid_password") {
    return "Incorrect room password. Try again."
  }
  return "This room requires a join password."
}

/**
 * Status shown while opening a new socket. If we were already connected,
 * surface "reconnecting"; otherwise "connecting".
 */
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
