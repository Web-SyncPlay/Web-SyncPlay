"use client"

import type { ClientEventPayloadMap, TypedRoomEventSender } from "@/lib/room-events"
import {
  createDefaultSessionCapabilities,
  type JoinStatus,
  type SessionCapabilities,
} from "@/lib/room-join-client"
import { createControlTokenReminter } from "@/lib/control-token-client"
import type { RoomState, SessionKind } from "@/zod/types"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  createRoomSocketConnection,
} from "./room-socket-connection"
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
  /* eslint-disable react-hooks/refs -- latest initialMediaUrl for join payload */
  initialMediaUrlRef.current = options?.initialMediaUrl
  /* eslint-enable react-hooks/refs */
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
  const controlTokenReminterRef = useRef(createControlTokenReminter())
  const { identity, controlTokenRef, usernameRef } =
    useSessionIdentityBootstrap({ roomId, sessionKind })

  const userId = identity?.userId ?? ""
  const userSecret = identity?.userSecret ?? ""

  useEffect(() => {
    if (!identity) {
      return
    }

    controlTokenReminterRef.current.reset()
    const connection = createRoomSocketConnection({
      roomId,
      sessionKind,
      identity,
      getInitialMediaUrl: () => initialMediaUrlRef.current,
      getJoinPassword: () => joinPasswordRef.current,
      controlTokenRef,
      usernameRef,
      roomStateRef,
      wsRef,
      stateTimeoutRef,
      hasReceivedStateRef,
      sfuProvideRef,
      sendJoinRef,
      controlTokenReminter: controlTokenReminterRef.current,
      setRoomState,
      setStatus,
      setJoinError,
      setSessionCapabilities,
    })

    void connection.connect()
    return () => {
      connection.dispose()
    }
  }, [roomId, identity, sessionKind, controlTokenRef, usernameRef])

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
