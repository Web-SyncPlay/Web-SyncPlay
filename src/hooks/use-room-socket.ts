"use client"

import type { TypedRoomEventSender } from "@/lib/room-events"
import {
  applyPresenceBatch,
  applyRoomControl,
  applyRoomSnapshot,
} from "@/lib/room-state-merge"
import { getRandomName } from "@/lib/room-utils"
import {
  consumeSessionIdentityFromHash,
  getOrCreateSessionIdentity,
  getPersistedUsername,
  persistUsername,
  stripIdentityHashFromUrl,
} from "@/lib/session-identity"
import type {
  PresenceBatchPayload,
  RoomControlPayload,
  RoomSnapshotPayload,
  RoomState,
  SessionKind,
  WsEnvelope,
} from "@/zod/types"
import { useCallback, useEffect, useRef, useState } from "react"

type SessionCapabilities = {
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

type JoinRejectedReason = "password_required" | "invalid_password" | "rate_limited"

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
    useState<SessionCapabilities>({
      canControlPlayback: false,
      canManagePlaylist: false,
      canManageRoomSecurity: false,
      isControlSession: sessionKind === "control",
      controlAuthorized: false,
      sessionKind,
    })

  const wsRef = useRef<WebSocket | null>(null)
  const stateTimeoutRef = useRef<number | undefined>(undefined)
  const hasReceivedStateRef = useRef(false)
  const roomStateRef = useRef<RoomState | null>(null)
  const usernameRef = useRef<string>("guest")
  const joinPasswordRef = useRef<string>("")
  const sendJoinRef = useRef<(() => void) | null>(null)
  const controlTokenRef = useRef<string | undefined>(undefined)
  const [identity, setIdentity] = useState<{
    userId: string
    userSecret: string
  } | null>(null)

  const userId = identity?.userId ?? ""
  const userSecret = identity?.userSecret ?? ""

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const fromHash = await consumeSessionIdentityFromHash()
      if (fromHash.controlToken) {
        controlTokenRef.current = fromHash.controlToken
      }
      const session = await getOrCreateSessionIdentity()
      if (cancelled) {
        return
      }
      setIdentity({
        userId: fromHash.userId ?? session.userId,
        userSecret: fromHash.userSecret ?? session.userSecret,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    // Some clients briefly re-apply the initial hash during hydration/history sync.
    // Re-strip identity bootstrap fragments after mount and on hash changes.
    const strip = () => {
      stripIdentityHashFromUrl()
    }
    strip()
    const stripTimer = window.setTimeout(strip, 0)
    const stripRaf = window.requestAnimationFrame(strip)
    window.addEventListener("hashchange", strip)
    return () => {
      window.clearTimeout(stripTimer)
      window.cancelAnimationFrame(stripRaf)
      window.removeEventListener("hashchange", strip)
    }
  }, [])

  useEffect(() => {
    const persistedUsername = getPersistedUsername()
    if (persistedUsername) {
      usernameRef.current = persistedUsername
      return
    }
    try {
      usernameRef.current = getRandomName()
      persistUsername(usernameRef.current)
    } catch {
      usernameRef.current = "guest"
      persistUsername(usernameRef.current)
    }
  }, [])

  useEffect(() => {
    if (!identity) {
      return
    }

    let cancelled = false
    let reconnectTimer: number | undefined
    const wsOrigin = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/api/ws`

    const connect = async (): Promise<void> => {
      hasReceivedStateRef.current = false
      setJoinError(null)
      setSessionCapabilities({
        canControlPlayback: false,
        canManagePlaylist: false,
        canManageRoomSecurity: false,
        isControlSession: sessionKind === "control",
        controlAuthorized: false,
        sessionKind,
      })
      if (stateTimeoutRef.current) {
        window.clearTimeout(stateTimeoutRef.current)
      }
      setStatus((prev) =>
        prev === "connected" ? "reconnecting" : "connecting",
      )

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
            JSON.stringify({
              type: "room:join",
              requestId:
                typeof crypto?.randomUUID === "function"
                  ? crypto.randomUUID()
                  : undefined,
              payload: {
                roomId,
                userId: identity.userId,
                userSecret: identity.userSecret,
                joinPassword: joinPasswordRef.current || undefined,
                username: usernameRef.current,
                sessionKind,
                controlToken: controlTokenRef.current,
                initialMediaUrl: initialMediaUrlRef.current,
              },
            } satisfies WsEnvelope<string, Record<string, unknown>>),
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

        if (envelope.type === "local-media:read") {
          const payload = envelope.payload as {
            requestId?: string
            localMediaId?: string
            start?: number
            end?: number
          }
          const requestId = payload.requestId
          const localMediaId = payload.localMediaId
          const start = payload.start
          const end = payload.end
          if (
            !requestId ||
            !localMediaId ||
            typeof start !== "number" ||
            typeof end !== "number"
          ) {
            return
          }

          void (async () => {
            const { getLocalMediaFile } = await import(
              "@/lib/local-media-provider"
            )
            const { encodeLocalMediaChunkFrame } = await import(
              "@/lib/local-media-binary"
            )
            const file = getLocalMediaFile(localMediaId)
            // Stay silent when this tab does not hold the File so another
            // session for the same user can still answer the range request.
            if (!file) {
              return
            }
            try {
              const slice = file.slice(start, end + 1)
              const buffer = await slice.arrayBuffer()
              // Binary LMC frame avoids ~33% base64 overhead on the wire.
              const frame = encodeLocalMediaChunkFrame({
                requestId,
                ok: true,
                data: new Uint8Array(buffer),
              })
              // Fresh ArrayBuffer-backed view satisfies DOM WebSocket BufferSource typings.
              const wire = new Uint8Array(frame.byteLength)
              wire.set(frame)
              ws.send(wire)
            } catch (error) {
              console.error("[local-media] failed to read range", {
                localMediaId,
                requestId,
                start,
                end,
                error,
              })
              // Keep JSON error path for simplicity / older server compat.
              ws.send(
                JSON.stringify({
                  type: "local-media:chunk",
                  requestId: crypto.randomUUID(),
                  payload: {
                    requestId,
                    ok: false,
                    error: "read_failed",
                  },
                }),
              )
            }
          })()
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
            void import("@/lib/local-media-provider").then(
              ({ announceLocalMediaProviderReady }) => {
                if (ws.readyState !== WebSocket.OPEN) return
                announceLocalMediaProviderReady(
                  (type, readyPayload) => {
                    ws.send(
                      JSON.stringify({
                        type,
                        payload: readyPayload,
                        requestId: crypto.randomUUID(),
                      }),
                    )
                  },
                  payload,
                  identity.userId,
                )
              },
            )
          }
          return
        }

        if (envelope.type === "local-media:reannounce") {
          void import("@/lib/local-media-provider").then(
            ({ announceLocalMediaProviderReady }) => {
              if (ws.readyState !== WebSocket.OPEN) return
              announceLocalMediaProviderReady(
                (type, readyPayload) => {
                  ws.send(
                    JSON.stringify({
                      type,
                      payload: readyPayload,
                      requestId: crypto.randomUUID(),
                    }),
                  )
                },
                roomStateRef.current,
                identity.userId,
              )
            },
          )
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
          setSessionCapabilities({
            canControlPlayback: Boolean(payload.canControlPlayback),
            canManagePlaylist: Boolean(payload.canManagePlaylist),
            canManageRoomSecurity: Boolean(payload.canManageRoomSecurity),
            isControlSession: Boolean(payload.isControlSession),
            controlAuthorized: Boolean(payload.controlAuthorized),
            sessionKind:
              (payload.sessionKind as SessionKind | undefined) ?? sessionKind,
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
          if (payload.reason === "invalid_password") {
            setJoinError("Incorrect room password. Try again.")
          } else {
            setJoinError("This room requires a join password.")
          }
          setStatus("awaiting_password")
        }
      }

      ws.onerror = () => {
        console.error("[realtime] websocket error")
        ws.close()
      }

      ws.onclose = () => {
        console.warn("[realtime] websocket closed")
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
