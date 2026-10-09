"use client"

import { createRoomSocketLocalMediaSession } from "@/hooks/room-socket-local-media"
import {
  createControlTokenRefreshScheduler,
  createControlTokenReminter,
} from "@/lib/control-token-client"
import {
  applyPresenceBatches,
  applyRoomControl,
  applyRoomSnapshot,
  createPresenceBatchCoalescer,
} from "@/lib/room-state-merge"
import {
  buildRoomJoinEnvelope,
  createDefaultSessionCapabilities,
  isTerminalJoinRejection,
  messageForJoinRejected,
  nextJoinStatusOnConnectAttempt,
  normalizeSessionCapabilities,
  RATE_LIMITED_RECONNECT_MS,
  shouldPauseAutoReconnect,
  statusForJoinRejected,
  type JoinRejectedReason,
  type JoinStatus,
  type SessionCapabilities,
} from "@/lib/room-join-client"
import {
  loadPersistedControlToken,
  persistUsername,
} from "@/lib/session-identity"
import type {
  PresenceBatchPayload,
  RoomControlPayload,
  RoomSnapshotPayload,
  RoomState,
  SessionKind,
  WsEnvelope,
} from "@/zod/types"
import { startTransition, type Dispatch, type MutableRefObject, type SetStateAction } from "react"

export { createControlTokenReminter }

export type ControlTokenReminter = ReturnType<typeof createControlTokenReminter>

export type RoomSocketConnectionOptions = {
  roomId: string
  sessionKind: SessionKind
  identity: { userId: string; userSecret: string }
  getInitialMediaUrl: () => string | undefined
  getJoinPassword: () => string
  controlTokenRef: MutableRefObject<string | undefined>
  usernameRef: MutableRefObject<string>
  roomStateRef: MutableRefObject<RoomState | null>
  wsRef: MutableRefObject<WebSocket | null>
  stateTimeoutRef: MutableRefObject<number | undefined>
  hasReceivedStateRef: MutableRefObject<boolean>
  sfuProvideRef: MutableRefObject<((localMediaId: string) => void) | null>
  sendJoinRef: MutableRefObject<(() => void) | null>
  controlTokenReminter: ControlTokenReminter
  setRoomState: Dispatch<SetStateAction<RoomState | null>>
  setStatus: Dispatch<SetStateAction<JoinStatus>>
  setJoinError: Dispatch<SetStateAction<string | null>>
  setSessionCapabilities: Dispatch<SetStateAction<SessionCapabilities>>
  fetchWsInit?: () => Promise<boolean>
  createWebSocket?: (url: string) => WebSocket
  wsOrigin?: string
}

const DEFAULT_RECONNECT_MS = 1000
const DEFAULT_JOIN_RETRY_MS = 800
const DEFAULT_STATE_TIMEOUT_MS = 5000
const MAX_JOIN_ATTEMPTS = 3

function defaultWsOrigin(): string {
  return `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/api/ws`
}

async function defaultFetchWsInit(): Promise<boolean> {
  const response = await fetch(`/api/ws?init=${Date.now()}`, {
    cache: "no-store",
    headers: { "cache-control": "no-cache" },
  })
  return response.ok
}

export function createRoomSocketConnection(
  options: RoomSocketConnectionOptions,
): {
  connect: () => Promise<void>
  dispose: () => void
} {
  let cancelled = false
  /** When set, onclose must not schedule the default short reconnect. */
  let pauseAutoReconnect = false
  let reconnectTimer: number | undefined
  let detachSwBridge: (() => void) | null = null
  let disposePresenceCoalesce: (() => void) | null = null
  let clearReconnectTimers: (() => void) | null = null

  const fetchWsInit = options.fetchWsInit ?? defaultFetchWsInit
  const createWebSocket = options.createWebSocket ?? ((url) => new WebSocket(url))
  const wsOrigin = options.wsOrigin ?? defaultWsOrigin()

  /** Proactive remint before expiry; reconnect so join uses the new `ct`. */
  const controlTokenRefresh =
    options.sessionKind === "control"
      ? createControlTokenRefreshScheduler({
          onMinted: (minted) => {
            if (cancelled) {
              return
            }
            options.controlTokenRef.current = minted.token
            try {
              options.wsRef.current?.close()
            } catch {
              // reconnect via onclose
            }
          },
        })
      : null

  const syncControlTokenFromStorage = (): void => {
    if (options.sessionKind !== "control") {
      return
    }
    const persisted = loadPersistedControlToken(options.roomId)
    if (persisted) {
      options.controlTokenRef.current = persisted
    }
  }

  const connect = async (): Promise<void> => {
    pauseAutoReconnect = false
    syncControlTokenFromStorage()
    controlTokenRefresh?.armFromStorage({
      roomId: options.roomId,
      userId: options.identity.userId,
      userSecret: options.identity.userSecret,
    })
    options.hasReceivedStateRef.current = false
    options.setJoinError(null)
    options.setSessionCapabilities(
      createDefaultSessionCapabilities(options.sessionKind),
    )
    if (options.stateTimeoutRef.current) {
      window.clearTimeout(options.stateTimeoutRef.current)
    }
    options.setStatus(nextJoinStatusOnConnectAttempt)

    try {
      const ok = await fetchWsInit()
      if (!ok) {
        throw new Error("WS init failed")
      }
    } catch {
      if (!cancelled) {
        reconnectTimer = window.setTimeout(() => {
          void connect()
        }, DEFAULT_RECONNECT_MS)
      }
      return
    }

    if (cancelled) {
      return
    }

    const ws = createWebSocket(wsOrigin)
    options.wsRef.current = ws
    let joinRetryTimer: number | undefined
    let joinAttempts = 0

    const clearStateTimeout = () => {
      if (options.stateTimeoutRef.current) {
        window.clearTimeout(options.stateTimeoutRef.current)
        options.stateTimeoutRef.current = undefined
      }
    }

    const scheduleStateTimeout = () => {
      clearStateTimeout()
      options.stateTimeoutRef.current = window.setTimeout(() => {
        if (cancelled) {
          return
        }

        if (
          ws.readyState === WebSocket.OPEN &&
          !options.hasReceivedStateRef.current
        ) {
          console.warn("[realtime] no room state after join, reconnecting")
          ws.close()
        }
      }, DEFAULT_STATE_TIMEOUT_MS)
    }

    const localMedia = createRoomSocketLocalMediaSession({
      ws,
      roomId: options.roomId,
      userId: options.identity.userId,
      roomStateRef: options.roomStateRef,
      getDetachSwBridge: () => detachSwBridge,
      setDetachSwBridge: (detach) => {
        detachSwBridge = detach
      },
    })
    options.sfuProvideRef.current = localMedia.provideViaSfu

    disposePresenceCoalesce?.()
    const presenceCoalescer = createPresenceBatchCoalescer({
      onFlush: (payloads) => {
        if (cancelled) return
        startTransition(() => {
          options.setRoomState((prev) => {
            const next = applyPresenceBatches(prev, payloads)
            options.roomStateRef.current = next
            return next
          })
        })
      },
    })
    disposePresenceCoalesce = () => presenceCoalescer.dispose()

    const sendJoin = (): void => {
      if (cancelled) {
        return
      }
      if (ws.readyState !== WebSocket.OPEN) {
        return
      }
      if (options.hasReceivedStateRef.current) {
        return
      }

      // Prefer latest reminted token from sessionStorage on each join attempt.
      syncControlTokenFromStorage()

      joinAttempts += 1
      options.setStatus(
        options.getJoinPassword() ? "joining" : "connecting",
      )
      options.setJoinError(null)
      try {
        ws.send(
          JSON.stringify(
            buildRoomJoinEnvelope({
              roomId: options.roomId,
              userId: options.identity.userId,
              userSecret: options.identity.userSecret,
              joinPassword: options.getJoinPassword(),
              username: options.usernameRef.current,
              sessionKind: options.sessionKind,
              controlToken: options.controlTokenRef.current,
              initialMediaUrl: options.getInitialMediaUrl(),
              requestId:
                typeof crypto?.randomUUID === "function"
                  ? crypto.randomUUID()
                  : undefined,
            }),
          ),
        )
      } catch (error) {
        console.error("[realtime] failed to send room:join", error)
        return
      }

      scheduleStateTimeout()
      if (joinAttempts < MAX_JOIN_ATTEMPTS && !options.hasReceivedStateRef.current) {
        joinRetryTimer = window.setTimeout(sendJoin, DEFAULT_JOIN_RETRY_MS)
      }
    }
    options.sendJoinRef.current = sendJoin

    ws.onopen = () => {
      options.setStatus("connected")
      sendJoin()
    }

    ws.onmessage = (event) => {
      const envelope = JSON.parse(event.data) as WsEnvelope<string, unknown>

      if (localMedia.handleEnvelope(envelope)) {
        return
      }

      if (envelope.type === "room:snapshot" || envelope.type === "room:state") {
        const firstStateAfterJoin = !options.hasReceivedStateRef.current
        options.hasReceivedStateRef.current = true
        pauseAutoReconnect = false
        clearStateTimeout()
        options.setJoinError(null)
        const payload = envelope.payload as RoomSnapshotPayload
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
          localMedia.bootstrapAfterFirstSnapshot(payload)
        }
        return
      }

      if (envelope.type === "room:control") {
        options.hasReceivedStateRef.current = true
        pauseAutoReconnect = false
        clearStateTimeout()
        options.setJoinError(null)
        const payload = envelope.payload as RoomControlPayload
        options.setRoomState((prev) => {
          const next = applyRoomControl(prev, payload)
          options.roomStateRef.current = next
          return next
        })
        return
      }

      if (envelope.type === "presence:batch") {
        presenceCoalescer.enqueue(envelope.payload as PresenceBatchPayload)
        return
      }

      if (envelope.type === "session:capabilities") {
        const payload = envelope.payload as Partial<SessionCapabilities>
        const caps = normalizeSessionCapabilities(payload, options.sessionKind)
        options.setSessionCapabilities(caps)
        const role =
          options.roomStateRef.current?.participants[options.identity.userId]
            ?.role
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
            if (cancelled || !token) {
              return
            }
            options.controlTokenRef.current = token
            controlTokenRefresh?.armFromStorage({
              roomId: options.roomId,
              userId: options.identity.userId,
              userSecret: options.identity.userSecret,
            })
            try {
              options.wsRef.current?.close()
            } catch {
              // reconnect via onclose
            }
          })
        return
      }

      if (envelope.type === "room:join:rejected") {
        if (joinRetryTimer) {
          window.clearTimeout(joinRetryTimer)
          joinRetryTimer = undefined
        }
        clearStateTimeout()
        const payload = envelope.payload as { reason?: JoinRejectedReason }
        const reason = payload.reason
        options.setJoinError(messageForJoinRejected(reason))
        options.setStatus(statusForJoinRejected(reason))

        if (!shouldPauseAutoReconnect(reason)) {
          return
        }

        clearReconnectTimers?.()
        pauseAutoReconnect = true

        if (isTerminalJoinRejection(reason)) {
          cancelled = true
          try {
            ws.close()
          } catch {
            // ignore
          }
          return
        }

        if (reason === "rate_limited") {
          // Close and resume after cooldown so we do not join-storm.
          try {
            ws.close()
          } catch {
            // ignore
          }
          if (!cancelled) {
            reconnectTimer = window.setTimeout(() => {
              pauseAutoReconnect = false
              void connect()
            }, RATE_LIMITED_RECONNECT_MS)
          }
        }
        // awaiting_password: keep the open socket for submitJoinPassword;
        // onclose must not auto-reconnect until the user succeeds or leaves.
      }
    }

    ws.onerror = () => {
      console.error("[realtime] websocket error")
      ws.close()
    }

    ws.onclose = () => {
      if (!cancelled) {
        console.warn("[realtime] websocket closed")
      }
      disposePresenceCoalesce?.()
      disposePresenceCoalesce = null
      if (options.sfuProvideRef.current === localMedia.provideViaSfu) {
        options.sfuProvideRef.current = null
      }
      localMedia.onSocketClose()
      if (joinRetryTimer) {
        window.clearTimeout(joinRetryTimer)
      }
      clearStateTimeout()

      if (cancelled || pauseAutoReconnect) {
        return
      }

      options.setStatus("reconnecting")
      reconnectTimer = window.setTimeout(() => {
        void connect()
      }, DEFAULT_RECONNECT_MS)
    }
  }

  clearReconnectTimers = () => {
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer)
      reconnectTimer = undefined
    }
  }

  const dispose = (): void => {
    cancelled = true
    pauseAutoReconnect = false
    controlTokenRefresh?.disarm()
    options.hasReceivedStateRef.current = false
    options.sendJoinRef.current = null
    options.sfuProvideRef.current = null
    disposePresenceCoalesce?.()
    disposePresenceCoalesce = null
    detachSwBridge?.()
    detachSwBridge = null
    clearReconnectTimers?.()

    if (options.stateTimeoutRef.current) {
      window.clearTimeout(options.stateTimeoutRef.current)
      options.stateTimeoutRef.current = undefined
    }
    options.wsRef.current?.close()
  }

  return { connect, dispose }
}
