"use client"

import type { SfuResult, SfuSendRequest } from "@/lib/local-media-sfu"
import type {
  ClientEventPayloadMap,
  TypedRoomEventSender,
} from "@/lib/room-events"
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
  const sfuProvideRef = useRef<((localMediaId: string) => void) | null>(null)
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
    let detachSwBridge: (() => void) | null = null
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

      const sfuPending = new Map<string, (result: SfuResult) => void>()
      let sfuAvailable = false
      const pendingSfuProvide = new Set<string>()
      const sendSfuRequest: SfuSendRequest = (type, payload) =>
        new Promise<SfuResult>((resolve) => {
          if (ws.readyState !== WebSocket.OPEN) {
            resolve({ ok: false, error: "socket_closed" })
            return
          }
          const requestId = crypto.randomUUID()
          const timer = window.setTimeout(() => {
            sfuPending.delete(requestId)
            resolve({ ok: false, error: "sfu_request_timeout" })
          }, 15_000)
          sfuPending.set(requestId, (result) => {
            window.clearTimeout(timer)
            resolve(result)
          })
          ws.send(JSON.stringify({ type, payload, requestId }))
        })
      const flushSfuPending = () => {
        for (const [id, resolve] of sfuPending) {
          sfuPending.delete(id)
          resolve({ ok: false, error: "socket_closed" })
        }
      }
      const provideViaSfu = (localMediaId: string) => {
        if (!sfuAvailable) {
          pendingSfuProvide.add(localMediaId)
          return
        }
        void import("@/lib/local-media-sfu").then(
          ({ ensureLocalMediaSfuProvider }) =>
            ensureLocalMediaSfuProvider(localMediaId, sendSfuRequest),
        )
      }
      sfuProvideRef.current = provideViaSfu

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
            void (async () => {
              // Ask for SFU capabilities now so IndexedDB restore does not delay it.
              const capabilitiesRequest =
                ws.readyState === WebSocket.OPEN
                  ? sendSfuRequest("local-media:sfu:capabilities", {})
                  : null
              if (capabilitiesRequest) {
                void capabilitiesRequest.then(async (capabilities) => {
                  if (!capabilities.ok || ws.readyState !== WebSocket.OPEN) {
                    return
                  }
                  const [
                    { configureLocalMediaSfu, ensureLocalMediaSfuViewer },
                    { listLocalMediaIds, getLocalMediaFile },
                  ] = await Promise.all([
                    import("@/lib/local-media-sfu"),
                    import("@/lib/local-media-provider"),
                  ])
                  if (ws.readyState !== WebSocket.OPEN) return
                  sfuAvailable = true
                  configureLocalMediaSfu(sendSfuRequest)
                  const toProvide = new Set([
                    ...pendingSfuProvide,
                    ...listLocalMediaIds(),
                  ])
                  pendingSfuProvide.clear()
                  for (const localMediaId of toProvide) {
                    provideViaSfu(localMediaId)
                  }
                  // Late joiners missed produce broadcasts; consume existing SFU producers.
                  const announced = Array.isArray(capabilities.producers)
                    ? (capabilities.producers as Array<{
                        localMediaId?: string
                      }>)
                    : []
                  const fromPlaylist = (roomStateRef.current?.playlist ?? [])
                    .map((item) => item.localMediaId)
                    .filter((id): id is string => Boolean(id))
                  for (const localMediaId of new Set([
                    ...announced
                      .map((p) => p.localMediaId)
                      .filter((id): id is string => Boolean(id)),
                    ...fromPlaylist,
                  ])) {
                    if (getLocalMediaFile(localMediaId)) continue
                    void ensureLocalMediaSfuViewer(localMediaId, sendSfuRequest)
                  }
                })
              }

              const {
                announceLocalMediaProviderReady,
                registerLocalMediaFile,
                listLocalMediaIds,
              } = await import("@/lib/local-media-provider")
              const { restoreLocalMediaHandles } = await import(
                "@/lib/local-media-handles"
              )
              const { inviteLocalMediaWebrtcViewer, configureLocalMediaWebrtc } =
                await import("@/lib/local-media-webrtc")
              const {
                registerLocalMediaServiceWorker,
                attachLocalMediaServiceWorkerBridge,
              } = await import("@/lib/local-media-sw")

              if (ws.readyState !== WebSocket.OPEN) return

              configureLocalMediaWebrtc({
                sendSignal: (targetUserId, localMediaId, signal) => {
                  if (ws.readyState !== WebSocket.OPEN) return
                  ws.send(
                    JSON.stringify({
                      type: "local-media:webrtc:signal",
                      requestId: crypto.randomUUID(),
                      payload: { localMediaId, targetUserId, signal },
                    }),
                  )
                },
              })
              void registerLocalMediaServiceWorker()
              detachSwBridge?.()
              detachSwBridge = attachLocalMediaServiceWorkerBridge({
                resolveProviderUserId: (localMediaId) => {
                  const state = roomStateRef.current
                  if (!state) return null
                  const item = state.playlist.find(
                    (p) => p.localMediaId === localMediaId,
                  )
                  return item?.localOriginUserId ?? null
                },
                resolveMediaMeta: (localMediaId) => {
                  const item = roomStateRef.current?.playlist.find(
                    (p) => p.localMediaId === localMediaId,
                  )
                  if (!item) return null
                  const mimeType =
                    item.localMimeType ??
                    item.mediaStreams?.find((s) => s.type)?.type
                  if (!mimeType || !item.localSizeBytes) return null
                  return { mimeType, sizeBytes: item.localSizeBytes }
                },
              })

              await restoreLocalMediaHandles({
                roomId,
                userId: identity.userId,
                register: registerLocalMediaFile,
              })
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

              // Provider invites other room members onto DataChannels (C0 mesh).
              const held = listLocalMediaIds()
              if (held.length > 0) {
                for (const participant of Object.values(payload.participants)) {
                  if (participant.userId === identity.userId) continue
                  if (!participant.connected) continue
                  for (const localMediaId of held) {
                    void inviteLocalMediaWebrtcViewer({
                      localMediaId,
                      viewerUserId: participant.userId,
                    })
                  }
                }
              }

              // Files restored from IndexedDB are published once the SFU is
              // available (queued if capabilities are still pending).
              for (const localMediaId of held) {
                provideViaSfu(localMediaId)
              }
            })()
          }
          return
        }

        if (envelope.type === "local-media:sfu:result") {
          const requestId = envelope.requestId
          const resolve = requestId ? sfuPending.get(requestId) : undefined
          if (!requestId || !resolve) return
          sfuPending.delete(requestId)
          resolve(envelope.payload as SfuResult)
          return
        }

        if (envelope.type === "local-media:sfu:producer") {
          if (!sfuAvailable) return
          const payload = envelope.payload as {
            localMediaId?: string
            dataProducerId?: string
            ownerUserId?: string
            kind?: "provider" | "requests"
          }
          const { localMediaId, dataProducerId, ownerUserId } = payload
          if (!localMediaId || !dataProducerId || !ownerUserId) return
          const isSelfOwner = ownerUserId === identity.userId

          void (async () => {
            const sfu = await import("@/lib/local-media-sfu")
            const { getLocalMediaFile } = await import(
              "@/lib/local-media-provider"
            )
            const holdsFile = Boolean(getLocalMediaFile(localMediaId))
            if (payload.kind === "requests") {
              if (isSelfOwner && holdsFile) {
                await sfu.ensureLocalMediaSfuRequestConsumer(
                  localMediaId,
                  dataProducerId,
                  sendSfuRequest,
                )
              }
              return
            }
            if (!holdsFile) {
              await sfu.ensureLocalMediaSfuViewer(localMediaId, sendSfuRequest)
            }
          })()
          return
        }

        if (envelope.type === "local-media:webrtc:signal") {
          const payload = envelope.payload as {
            localMediaId?: string
            fromUserId?: string
            signal?: {
              type: "offer" | "answer" | "ice" | "hangup"
              sdp?: string
              candidate?: string
              sdpMid?: string
              sdpMLineIndex?: number
            }
          }
          if (
            !payload.localMediaId ||
            !payload.fromUserId ||
            !payload.signal
          ) {
            return
          }
          void import("@/lib/local-media-webrtc").then(
            async ({ handleLocalMediaWebrtcSignalFromPeer }) => {
              const { getLocalMediaFile } = await import(
                "@/lib/local-media-provider"
              )
              await handleLocalMediaWebrtcSignalFromPeer({
                localMediaId: payload.localMediaId!,
                fromUserId: payload.fromUserId!,
                signal: payload.signal!,
                isProvider: Boolean(getLocalMediaFile(payload.localMediaId!)),
              })
            },
          )
          return
        }

        if (envelope.type === "local-media:reannounce") {
          void (async () => {
            const {
              announceLocalMediaProviderReady,
              registerLocalMediaFile,
            } = await import("@/lib/local-media-provider")
            const { restoreLocalMediaHandles } = await import(
              "@/lib/local-media-handles"
            )
            if (ws.readyState !== WebSocket.OPEN) return
            await restoreLocalMediaHandles({
              roomId,
              userId: identity.userId,
              register: registerLocalMediaFile,
            })
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
          })()
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
        // Intentional unmount/reconnect teardown — avoid noisy console warns.
        if (!cancelled) {
          console.warn("[realtime] websocket closed")
        }
        sfuAvailable = false
        pendingSfuProvide.clear()
        detachSwBridge?.()
        detachSwBridge = null
        if (sfuProvideRef.current === provideViaSfu) {
          sfuProvideRef.current = null
        }
        flushSfuPending()
        void import("@/lib/local-media-sfu").then(({ closeLocalMediaSfu }) =>
          closeLocalMediaSfu(sendSfuRequest),
        )
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
