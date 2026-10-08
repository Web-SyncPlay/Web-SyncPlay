"use client"

import type { ClientEventPayloadMap, TypedRoomEventSender } from "@/lib/room-events"
import {
  applyPresenceBatch,
  applyRoomControl,
  applyRoomSnapshot,
} from "@/lib/room-state-merge"
import {
  buildRoomJoinEnvelope,
  createDefaultSessionCapabilities,
  messageForJoinRejected,
  nextJoinStatusOnConnectAttempt,
  normalizeSessionCapabilities,
  statusForJoinRejected,
  type JoinRejectedReason,
  type JoinStatus,
  type SessionCapabilities,
} from "@/lib/room-join-client"
import { persistUsername } from "@/lib/session-identity"
import type {
  PresenceBatchPayload,
  RoomControlPayload,
  RoomSnapshotPayload,
  RoomState,
  SessionKind,
  WsEnvelope,
} from "@/zod/types"
import { useCallback, useEffect, useRef, useState } from "react"
import { createRoomSocketLocalMediaSession } from "./room-socket-local-media"
import { useSessionIdentityBootstrap } from "./use-session-identity-bootstrap"

export type { JoinStatus, SessionCapabilities } from "@/lib/room-join-client"

export function useRoomSocket(
  roomId: string,
  options?: { sessionKind?: SessionKind; initialMediaUrl?: string },
): {
  roomState: RoomState | null
  sessionCapabilities: SessionCapabilities
  send: TypedRoomEventSender
  userId: string
  userSecret: string
  status: JoinStatus
  joinError: string | null
  submitJoinPassword: (password: string) => void
} {
  const sessionKind = options?.sessionKind ?? "room"
  const initialMediaUrlRef = useRef(options?.initialMediaUrl)
  initialMediaUrlRef.current = options?.initialMediaUrl
  const [roomState, setRoomState] = useState<RoomState | null>(null)
  const [status, setStatus] = useState<JoinStatus>("connecting")
  const [joinError, setJoinError] = useState<string | null>(null)
  const [sessionCapabilities, setSessionCapabilities] =
    useState<SessionCapabilities>(() =>
      createDefaultSessionCapabilities(sessionKind),
    )

  const wsRef = useRef<WebSocket | null>(null)
  const stateTimeoutRef = useRef<number | undefined>(undefined)
  const hasReceivedStateRef = useRef(false)
  const roomStateRef = useRef<RoomState | null>(null)
  const joinPasswordRef = useRef<string>("")
  const sendJoinRef = useRef<(() => void) | null>(null)
  const sfuProvideRef = useRef<((localMediaId: string) => void) | null>(null)
  const { identity, controlTokenRef, usernameRef } =
    useSessionIdentityBootstrap()

  const userId = identity?.userId ?? ""
  const userSecret = identity?.userSecret ?? ""

  useEffect(() => {
    if (!identity) {
      return
    }

    let cancelled = false
    let reconnectTimer: number | undefined
    let detachSwBridge: (() => void) | null = null
    const wsOrigin = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/api/ws`

    const connect = async (): Promise<void> => {
      hasReceivedStateRef.current = false
      setJoinError(null)
      setSessionCapabilities(createDefaultSessionCapabilities(sessionKind))
      if (stateTimeoutRef.current) {
        window.clearTimeout(stateTimeoutRef.current)
      }
      setStatus(nextJoinStatusOnConnectAttempt)

      try {
        const response = await fetch(`/api/ws?init=${Date.now()}`, {
          cache: "no-store",
          headers: { "cache-control": "no-cache" },
        })

        if (!response.ok) {
          throw new Error(`WS init failed: ${response.status}`)
        }
      } catch {
        reconnectTimer = window.setTimeout(() => {
          void connect()
        }, 1000)
        return
      }

      if (cancelled) {
        return
      }

      const ws = new WebSocket(wsOrigin)
      wsRef.current = ws
      let joinRetryTimer: number | undefined
      let joinAttempts = 0

      const clearStateTimeout = () => {
        if (stateTimeoutRef.current) {
          window.clearTimeout(stateTimeoutRef.current)
          stateTimeoutRef.current = undefined
        }
      }

      const scheduleStateTimeout = () => {
        clearStateTimeout()
        stateTimeoutRef.current = window.setTimeout(() => {
          if (cancelled) {
            return
          }

          if (
            ws.readyState === WebSocket.OPEN &&
            !hasReceivedStateRef.current
          ) {
            console.warn("[realtime] no room state after join, reconnecting")
            ws.close()
          }
        }, 5000)
      }

      const localMedia = createRoomSocketLocalMediaSession({
        ws,
        roomId,
        userId: identity.userId,
        roomStateRef,
        getDetachSwBridge: () => detachSwBridge,
        setDetachSwBridge: (detach) => {
          detachSwBridge = detach
        },
      })
      sfuProvideRef.current = localMedia.provideViaSfu

      const sendJoin = (): void => {
        if (cancelled) {
          return
        }
        if (ws.readyState !== WebSocket.OPEN) {
          return
        }
        if (hasReceivedStateRef.current) {
          return
        }

        joinAttempts += 1
        setStatus(joinPasswordRef.current ? "joining" : "connecting")
        setJoinError(null)
        try {
          ws.send(
            JSON.stringify(
              buildRoomJoinEnvelope({
                roomId,
                userId: identity.userId,
                userSecret: identity.userSecret,
                joinPassword: joinPasswordRef.current,
                username: usernameRef.current,
                sessionKind,
                controlToken: controlTokenRef.current,
                initialMediaUrl: initialMediaUrlRef.current,
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
        if (joinAttempts < 3 && !hasReceivedStateRef.current) {
          joinRetryTimer = window.setTimeout(sendJoin, 800)
        }
      }
      sendJoinRef.current = sendJoin

      ws.onopen = () => {
        setStatus("connected")
        sendJoin()
      }

      ws.onmessage = (event) => {
        const envelope = JSON.parse(event.data) as WsEnvelope<string, unknown>

        if (localMedia.handleEnvelope(envelope)) {
          return
        }

        if (envelope.type === "room:snapshot" || envelope.type === "room:state") {
          const firstStateAfterJoin = !hasReceivedStateRef.current
          hasReceivedStateRef.current = true
          clearStateTimeout()
          setJoinError(null)
          const payload = envelope.payload as RoomSnapshotPayload
          const selfParticipant = payload.participants[identity.userId]
          if (selfParticipant?.username) {
            usernameRef.current = selfParticipant.username
            persistUsername(selfParticipant.username)
          }
          setRoomState((prev) => {
            const next = applyRoomSnapshot(prev, payload)
            roomStateRef.current = next
            return next
          })
          if (firstStateAfterJoin) {
            localMedia.bootstrapAfterFirstSnapshot(payload)
          }
          return
        }

        if (envelope.type === "room:control") {
          hasReceivedStateRef.current = true
          clearStateTimeout()
          setJoinError(null)
          const payload = envelope.payload as RoomControlPayload
          setRoomState((prev) => {
            const next = applyRoomControl(prev, payload)
            roomStateRef.current = next
            return next
          })
          return
        }

        if (envelope.type === "presence:batch") {
          const payload = envelope.payload as PresenceBatchPayload
          setRoomState((prev) => {
            const next = applyPresenceBatch(prev, payload)
            roomStateRef.current = next
            return next
          })
          return
        }

        if (envelope.type === "session:capabilities") {
          const payload = envelope.payload as Partial<SessionCapabilities>
          setSessionCapabilities(
            normalizeSessionCapabilities(payload, sessionKind),
          )
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
          setJoinError(messageForJoinRejected(reason))
          setStatus(statusForJoinRejected(reason))
          // Unsupported create-time media will not succeed on retry — stop
          // reconnect churn for this tab until the host changes the URL.
          if (reason === "media_url_unsupported") {
            cancelled = true
            try {
              ws.close()
            } catch {
              // ignore
            }
          }
        }
      }

      ws.onerror = () => {
        console.error("[realtime] websocket error")
        ws.close()
      }

      ws.onclose = () => {
        // Intentional unmount/reconnect teardown — avoid noisy console warns.
        if (!cancelled) {
          console.warn("[realtime] websocket closed")
        }
        if (sfuProvideRef.current === localMedia.provideViaSfu) {
          sfuProvideRef.current = null
        }
        localMedia.onSocketClose()
        if (joinRetryTimer) {
          window.clearTimeout(joinRetryTimer)
        }
        clearStateTimeout()

        if (!cancelled) {
          setStatus("reconnecting")
          reconnectTimer = window.setTimeout(() => {
            void connect()
          }, 1000)
        }
      }
    }

    void connect()
    return () => {
      cancelled = true
      hasReceivedStateRef.current = false
      sendJoinRef.current = null
      sfuProvideRef.current = null
      detachSwBridge?.()
      detachSwBridge = null
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer)
      }

      if (stateTimeoutRef.current) {
        window.clearTimeout(stateTimeoutRef.current)
        stateTimeoutRef.current = undefined
      }
      wsRef.current?.close()
    }
  }, [roomId, identity, sessionKind])

  const send = useCallback<TypedRoomEventSender>((type, payload) => {
    wsRef.current?.send(
      JSON.stringify({ type, payload, requestId: crypto.randomUUID() }),
    )
    // A freshly shared File announces ready here; publish it on the SFU too.
    if (type === "local-media:ready") {
      const ready = payload as ClientEventPayloadMap["local-media:ready"]
      if (ready.ready) sfuProvideRef.current?.(ready.localMediaId)
    }
  }, [])

  const submitJoinPassword = useCallback((password: string) => {
    joinPasswordRef.current = password
    sendJoinRef.current?.()
  }, [])

  return {
    roomState,
    sessionCapabilities,
    send,
    userId,
    userSecret,
    status,
    joinError,
    submitJoinPassword,
  }
}
