"use client"

import {
  applyRoomControl,
  applyRoomSnapshot,
  type PresenceBatchCoalescer,
} from "@/client/realtime/room-state-merge"
import {
  createDefaultSessionCapabilities,
  isTerminalJoinRejection,
  messageForJoinRejected,
  normalizeSessionCapabilities,
  RATE_LIMITED_RECONNECT_MS,
  shouldPauseAutoReconnect,
  statusForJoinRejected,
  type JoinStatus,
  type SessionCapabilities,
} from "@/client/realtime/room-join-client"
import type { createControlTokenReminter } from "@/client/realtime/control-token-client"
import { serverEventSchemas } from "@/contracts/s2c"

type ControlTokenReminter = ReturnType<typeof createControlTokenReminter>
import type {
  ClientRoomState,
  RoomSnapshotPayload,
  SessionKind,
  WsEnvelope,
} from "@/contracts/types"
import { parseOrWarn } from "@/shared/parse-or-warn"
import { observeServerNowMs } from "@/shared/server-clock"
import { persistUsername } from "@/client/realtime/session-identity"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"
import type { RoomSocketLocalMediaSession } from "./room-socket-local-media"

/** Dispatcher only needs boot + active envelope routing from the lifecycle facade. */
export type RoomSocketLocalMediaHandlers = Pick<
  RoomSocketLocalMediaSession,
  "handleEnvelope" | "bootstrapAfterFirstSnapshot"
>

export type RoomSocketDispatcherOptions = {
  roomId: string
  sessionKind: SessionKind
  identity: { userId: string; userSecret: string }
  roomStateRef: MutableRefObject<ClientRoomState | null>
  hasReceivedStateRef: MutableRefObject<boolean>
  controlTokenRef: MutableRefObject<string | undefined>
  usernameRef: MutableRefObject<string>
  wsRef: MutableRefObject<WebSocket | null>
  controlTokenReminter: ControlTokenReminter
  setRoomState: Dispatch<SetStateAction<ClientRoomState | null>>
  setStatus: Dispatch<SetStateAction<JoinStatus>>
  setJoinError: Dispatch<SetStateAction<string | null>>
  setSessionCapabilities: Dispatch<SetStateAction<SessionCapabilities>>
  presenceCoalescer: PresenceBatchCoalescer
  localMedia: RoomSocketLocalMediaHandlers
  isCancelled: () => boolean
  clearStateTimeout: () => void
  clearJoinRetry: () => void
  clearReconnectTimers: () => void
  setPauseAutoReconnect: (pause: boolean) => void
  scheduleRateLimitedReconnect: () => void
  armControlTokenRefresh: () => void
  setCancelled: () => void
}

/**
 * Server→client envelope dispatch (S2C parse + state merge).
 * Connection open/close/reconnect lifecycle stays in room-socket-connection.
 */
export function dispatchRoomSocketEnvelope(
  options: RoomSocketDispatcherOptions,
  envelope: WsEnvelope<string, unknown>,
): void {
  if (options.localMedia.handleEnvelope(envelope)) {
    return
  }

  if (envelope.type === "room:snapshot" || envelope.type === "room:state") {
    handleSnapshot(options, envelope)
    return
  }

  if (envelope.type === "room:control") {
    handleControl(options, envelope)
    return
  }

  if (envelope.type === "presence:batch") {
    const payload = parseOrWarn(
      serverEventSchemas["presence:batch"],
      envelope.payload,
      envelope.type,
      "[room-socket]",
    )
    if (!payload) return
    options.presenceCoalescer.enqueue(payload)
    return
  }

  if (envelope.type === "session:capabilities") {
    handleCapabilities(options, envelope)
    return
  }

  if (envelope.type === "room:admission:changed") {
    handleAdmissionChanged(options, envelope)
    return
  }

  if (envelope.type === "room:join:rejected") {
    handleJoinRejected(options, envelope)
    return
  }

  if (envelope.type === "room:error") {
    handleRoomError(envelope)
  }
}

function handleSnapshot(
  options: RoomSocketDispatcherOptions,
  envelope: WsEnvelope<string, unknown>,
) {
  const type = envelope.type as "room:snapshot" | "room:state"
  const payload = parseOrWarn(
    serverEventSchemas[type],
    envelope.payload,
    envelope.type,
    "[room-socket]",
  )
  if (!payload) return

  const firstStateAfterJoin = !options.hasReceivedStateRef.current
  options.hasReceivedStateRef.current = true
  options.setPauseAutoReconnect(false)
  options.clearStateTimeout()
  options.setJoinError(null)
  if (payload.playback && typeof payload.playback.serverNowMs === "number") {
    observeServerNowMs(payload.playback.serverNowMs)
  }
  const selfParticipant = payload.participants[options.identity.userId]
  if (selfParticipant?.username) {
    options.usernameRef.current = selfParticipant.username
    persistUsername(selfParticipant.username)
  }
  options.setRoomState((prev) => {
    const next = applyRoomSnapshot(prev, payload)
    options.roomStateRef.current = next
    return next
  })
  if (firstStateAfterJoin) {
    options.localMedia.bootstrapAfterFirstSnapshot(payload)
  }
}

function handleControl(
  options: RoomSocketDispatcherOptions,
  envelope: WsEnvelope<string, unknown>,
) {
  // Do not treat control as "joined" — only snapshot/state admit the client.
  const payload = parseOrWarn(
    serverEventSchemas["room:control"],
    envelope.payload,
    envelope.type,
    "[room-socket]",
  )
  if (!payload) return
  if (payload.playback && typeof payload.playback.serverNowMs === "number") {
    observeServerNowMs(payload.playback.serverNowMs)
  }
  if (!options.hasReceivedStateRef.current) return
  options.setPauseAutoReconnect(false)
  options.clearStateTimeout()
  options.setJoinError(null)
  options.setRoomState((prev) => {
    const next = applyRoomControl(prev, payload)
    options.roomStateRef.current = next
    return next
  })
}

function handleCapabilities(
  options: RoomSocketDispatcherOptions,
  envelope: WsEnvelope<string, unknown>,
) {
  const payload = parseOrWarn(
    serverEventSchemas["session:capabilities"],
    envelope.payload,
    envelope.type,
    "[room-socket]",
  )
  if (!payload) return
  const caps = normalizeSessionCapabilities(payload, options.sessionKind)
  options.setSessionCapabilities(caps)
  if (payload.viewerToken) {
    void import("@/client/local-media/local-media-viewer-token").then(
      ({ persistLocalMediaViewerToken }) => {
        persistLocalMediaViewerToken({
          roomId: options.roomId,
          userId: options.identity.userId,
          token: payload.viewerToken!,
        })
      },
    )
  }
  const role =
    options.roomStateRef.current?.participants[options.identity.userId]?.role
  void options.controlTokenReminter
    .tryRemint({
      roomId: options.roomId,
      userId: options.identity.userId,
      userSecret: options.identity.userSecret,
      sessionKind: options.sessionKind,
      controlAuthorized: caps.controlAuthorized,
      role,
    })
    .then((token) => {
      if (options.isCancelled() || !token) return
      options.controlTokenRef.current = token
      options.armControlTokenRefresh()
      try {
        options.wsRef.current?.close()
      } catch {
        // reconnect via onclose
      }
    })
}

function handleAdmissionChanged(
  options: RoomSocketDispatcherOptions,
  envelope: WsEnvelope<string, unknown>,
) {
  const payload = parseOrWarn(
    serverEventSchemas["room:admission:changed"],
    envelope.payload,
    envelope.type,
    "[room-socket]",
  )
  if (!payload) return
  options.clearJoinRetry()
  options.clearStateTimeout()
  // Revoke local admission so a later sendJoin / reconnect can re-join.
  options.hasReceivedStateRef.current = false
  options.roomStateRef.current = null
  options.setRoomState(null)
  options.setSessionCapabilities(
    createDefaultSessionCapabilities(options.sessionKind),
  )
  if (payload.joinPasswordEnabled) {
    options.setJoinError(messageForJoinRejected("password_required"))
    options.setStatus(statusForJoinRejected("password_required"))
    options.clearReconnectTimers()
    options.setPauseAutoReconnect(true)
  }
  // Password cleared: allow onclose auto-reconnect to re-admit without prompt.
  // Server closes non-owner sockets after this envelope.
}

function handleJoinRejected(
  options: RoomSocketDispatcherOptions,
  envelope: WsEnvelope<string, unknown>,
) {
  const payload = parseOrWarn(
    serverEventSchemas["room:join:rejected"],
    envelope.payload,
    envelope.type,
    "[room-socket]",
  )
  if (!payload) return
  options.clearJoinRetry()
  options.clearStateTimeout()
  const reason = payload.reason
  options.setJoinError(messageForJoinRejected(reason))
  options.setStatus(statusForJoinRejected(reason))

  if (!shouldPauseAutoReconnect(reason)) return

  options.clearReconnectTimers()
  options.setPauseAutoReconnect(true)

  if (isTerminalJoinRejection(reason)) {
    options.setCancelled()
    try {
      options.wsRef.current?.close()
    } catch {
      // ignore
    }
    return
  }

  if (reason === "rate_limited") {
    // Close and resume after cooldown so we do not join-storm.
    try {
      options.wsRef.current?.close()
    } catch {
      // ignore
    }
    if (!options.isCancelled()) {
      options.scheduleRateLimitedReconnect()
    }
  }
  // awaiting_password: keep the open socket for submitJoinPassword;
  // onclose must not auto-reconnect until the user succeeds or leaves.
}

function handleRoomError(envelope: WsEnvelope<string, unknown>) {
  const payload = parseOrWarn(
    serverEventSchemas["room:error"],
    envelope.payload,
    envelope.type,
    "[room-socket]",
  )
  if (!payload) return
  // Mutation nacks: log without breaking join / playback flows.
  console.warn("[room-socket] room:error", {
    requestId: envelope.requestId,
    code: payload.code,
    type: payload.type,
    message: payload.message,
  })
}

/** Re-export for tests that assert cooldown constant. */
export { RATE_LIMITED_RECONNECT_MS }
