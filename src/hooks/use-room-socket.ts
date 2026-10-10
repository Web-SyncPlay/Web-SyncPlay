"use client"

import type { ClientEventPayloadMap, TypedRoomEventSender } from "@/contracts/room-events"
import {
  createDefaultSessionCapabilities,
  type JoinStatus,
  type SessionCapabilities,
} from "@/client/realtime/room-join-client"
import { createControlTokenReminter } from "@/client/realtime/control-token-client"
import type { ClientRoomState, SessionKind } from "@/contracts/types"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  createRoomSocketConnection,
} from "@/client/realtime/room-socket/room-socket-connection"
import { useLatestRef } from "./use-latest-ref"
import { useSessionIdentityBootstrap } from "./use-session-identity-bootstrap"

export type { JoinStatus, SessionCapabilities } from "@/client/realtime/room-join-client"

export function useRoomSocket(
  roomId: string,
  options?: { sessionKind?: SessionKind; initialMediaUrl?: string },
): {
  roomState: ClientRoomState | null
  sessionCapabilities: SessionCapabilities
  send: TypedRoomEventSender
  userId: string
  userSecret: string
  status: JoinStatus
  joinError: string | null
  submitJoinPassword: (password: string) => void
} {
  const sessionKind = options?.sessionKind ?? "room"
  const initialMediaUrlRef = useLatestRef(options?.initialMediaUrl)
  const [roomState, setRoomState] = useState<ClientRoomState | null>(null)
  const [status, setStatus] = useState<JoinStatus>("connecting")
  const [joinError, setJoinError] = useState<string | null>(null)
  const [sessionCapabilities, setSessionCapabilities] =
    useState<SessionCapabilities>(() =>
      createDefaultSessionCapabilities(sessionKind),
    )

  const wsRef = useRef<WebSocket | null>(null)
  const stateTimeoutRef = useRef<number | undefined>(undefined)
  const hasReceivedStateRef = useRef(false)
  const roomStateRef = useRef<ClientRoomState | null>(null)
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
