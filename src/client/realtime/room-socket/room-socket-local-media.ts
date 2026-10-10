"use client"

import type { SfuSendRequest } from "@/client/local-media/local-media-sfu"
import { createLocalMediaRuntime } from "@/client/local-media/local-media-runtime"
import type {
  ClientRoomState,
  RoomSnapshotPayload,
  WsEnvelope,
} from "@/contracts/types"
import type { MutableRefObject } from "react"
import { createLocalMediaBootstrap } from "./room-socket-local-media-bootstrap"
import { createLocalMediaEnvelopeHandler } from "./room-socket-local-media-handlers"
import { createLocalMediaWebrtcSignalHandler } from "./room-socket-local-media-p2p"
import { createLocalMediaReadHandler } from "./room-socket-local-media-read"
import { createSendEnvelope } from "./room-socket-local-media-send"
import { createLocalMediaSfuSession } from "./room-socket-local-media-sfu"

export type RoomSocketLocalMediaSession = {
  sendSfuRequest: SfuSendRequest
  provideViaSfu: (localMediaId: string) => void
  /** Returns true when the envelope was handled as a local-media message. */
  handleEnvelope: (envelope: WsEnvelope<string, unknown>) => boolean
  bootstrapAfterFirstSnapshot: (payload: RoomSnapshotPayload) => void
  onSocketClose: () => void
}

/**
 * Owns SFU request correlation, local-media wire handlers, the
 * {@link createLocalMediaRuntime} instance, and first-snapshot bootstrap.
 * Keeps reconnect semantics in the caller — this tears down runtime + SFU state.
 */
export function createRoomSocketLocalMediaSession(input: {
  ws: WebSocket
  roomId: string
  userId: string
  roomStateRef: MutableRefObject<ClientRoomState | null>
  getDetachSwBridge: () => (() => void) | null
  setDetachSwBridge: (detach: (() => void) | null) => void
}): RoomSocketLocalMediaSession {
  const { ws, roomId, userId, roomStateRef } = input

  const sendEnvelope = createSendEnvelope(ws)
  const sfu = createLocalMediaSfuSession({ ws, userId })
  const runtime = createLocalMediaRuntime({
    send: sendEnvelope,
    roomId,
    userId,
    getRoomState: () => roomStateRef.current,
    getSfuSendRequest: () => sfu.sendSfuRequest,
  })
  const handleLocalMediaRead = createLocalMediaReadHandler(ws, runtime)
  const handleWebrtcSignal = createLocalMediaWebrtcSignalHandler()

  let bootstrapAbort: AbortController | null = null

  const { bootstrapAfterFirstSnapshot: runBootstrap, handleReannounce } =
    createLocalMediaBootstrap({
      ws,
      roomId,
      userId,
      roomStateRef,
      getDetachSwBridge: input.getDetachSwBridge,
      setDetachSwBridge: input.setDetachSwBridge,
      sendEnvelope,
      sfu,
      runtime,
    })

  const handleEnvelope = createLocalMediaEnvelopeHandler({
    sfu,
    handleLocalMediaRead,
    handleWebrtcSignal,
    handleReannounce: () => handleReannounce(bootstrapAbort?.signal),
  })

  const bootstrapAfterFirstSnapshot = (payload: RoomSnapshotPayload) => {
    bootstrapAbort?.abort()
    bootstrapAbort = new AbortController()
    runBootstrap(payload, bootstrapAbort.signal)
  }

  const onSocketClose = () => {
    bootstrapAbort?.abort()
    bootstrapAbort = null
    sfu.markSfuUnavailable()
    input.getDetachSwBridge()?.()
    input.setDetachSwBridge(null)
    sfu.flushSfuPending()
    runtime.close()
  }

  return {
    sendSfuRequest: sfu.sendSfuRequest,
    provideViaSfu: sfu.provideViaSfu,
    handleEnvelope,
    bootstrapAfterFirstSnapshot,
    onSocketClose,
  }
}
