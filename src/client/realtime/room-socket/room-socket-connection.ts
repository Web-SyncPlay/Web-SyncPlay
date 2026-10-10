"use client"

import { createRoomSocketLocalMediaSession } from "@/client/realtime/room-socket/room-socket-local-media"
import {
  createControlTokenRefreshScheduler,
  createControlTokenReminter,
} from "@/client/realtime/control-token-client"
import {
  applyPresenceBatches,
  createPresenceBatchCoalescer,
} from "@/client/realtime/room-state-merge"
import {
  buildRoomJoinEnvelope,
  createDefaultSessionCapabilities,
  nextJoinStatusOnConnectAttempt,
  RATE_LIMITED_RECONNECT_MS,
  type JoinStatus,
  type SessionCapabilities,
} from "@/client/realtime/room-join-client"
import { dispatchRoomSocketEnvelope } from "@/client/realtime/room-socket/room-socket-dispatcher"
import type {
  ClientRoomState,
  SessionKind,
  WsEnvelope,
} from "@/contracts/types"
import { clearLocalMediaViewerToken } from "@/shared/local-media/local-media-viewer-token"
import { loadPersistedControlToken } from "@/client/realtime/session-identity"
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
  roomStateRef: MutableRefObject<ClientRoomState | null>
  wsRef: MutableRefObject<WebSocket | null>
  stateTimeoutRef: MutableRefObject<number | undefined>
  hasReceivedStateRef: MutableRefObject<boolean>
  sfuProvideRef: MutableRefObject<((localMediaId: string) => void) | null>
  sendJoinRef: MutableRefObject<(() => void) | null>
  controlTokenReminter: ControlTokenReminter
  setRoomState: Dispatch<SetStateAction<ClientRoomState | null>>
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

/**
 * Connection lifecycle (connect / reconnect / dispose). Envelope routing is in
 * {@link dispatchRoomSocketEnvelope}.
 */
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
    // Drop presence watermark on reconnect so a reset/lagging Valkey
    // presenceSeq cannot permanently stall presence:batch (≤ localRev gate).
    if (options.roomStateRef.current) {
      const reset = {
        ...options.roomStateRef.current,
        presenceRevision: 0,
      }
      options.roomStateRef.current = reset
      options.setRoomState(reset)
    }
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
        // Force-closed (e.g. admission change); reconnect with current password.
        void connect()
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
      dispatchRoomSocketEnvelope(
        {
          roomId: options.roomId,
          sessionKind: options.sessionKind,
          identity: options.identity,
          roomStateRef: options.roomStateRef,
          hasReceivedStateRef: options.hasReceivedStateRef,
          controlTokenRef: options.controlTokenRef,
          usernameRef: options.usernameRef,
          wsRef: options.wsRef,
          controlTokenReminter: options.controlTokenReminter,
          setRoomState: options.setRoomState,
          setStatus: options.setStatus,
          setJoinError: options.setJoinError,
          setSessionCapabilities: options.setSessionCapabilities,
          presenceCoalescer,
          localMedia,
          isCancelled: () => cancelled,
          clearStateTimeout,
          clearJoinRetry: () => {
            if (joinRetryTimer) {
              window.clearTimeout(joinRetryTimer)
              joinRetryTimer = undefined
            }
          },
          clearReconnectTimers: () => clearReconnectTimers?.(),
          setPauseAutoReconnect: (pause) => {
            pauseAutoReconnect = pause
          },
          scheduleRateLimitedReconnect: () => {
            reconnectTimer = window.setTimeout(() => {
              pauseAutoReconnect = false
              void connect()
            }, RATE_LIMITED_RECONNECT_MS)
          },
          armControlTokenRefresh: () => {
            controlTokenRefresh?.armFromStorage({
              roomId: options.roomId,
              userId: options.identity.userId,
              userSecret: options.identity.userSecret,
            })
          },
          setCancelled: () => {
            cancelled = true
          },
        },
        envelope,
      )
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
    // Drop viewer capability so the SW stops decorating with a dead vt.
    // ws.close() below runs localMedia.onSocketClose → closeLocalMediaSfu.
    clearLocalMediaViewerToken()

    if (options.stateTimeoutRef.current) {
      window.clearTimeout(options.stateTimeoutRef.current)
      options.stateTimeoutRef.current = undefined
    }
    options.wsRef.current?.close()
  }

  return { connect, dispose }
}
