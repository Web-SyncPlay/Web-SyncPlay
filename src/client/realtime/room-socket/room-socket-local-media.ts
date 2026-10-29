"use client"

import type { MutableRefObject } from "react"

import { createLocalMediaRuntime } from "@/client/local-media/local-media-runtime"
import type {
  ClientRoomState,
  RoomSnapshotPayload,
  WsEnvelope,
} from "@/contracts/types"

import { createLocalMediaBootstrap } from "./room-socket-local-media-bootstrap"
import { createLocalMediaEnvelopeHandler } from "./room-socket-local-media-handlers"
import { createLocalMediaWebrtcSignalHandler } from "./room-socket-local-media-p2p"
import { createLocalMediaReadHandler } from "./room-socket-local-media-read"
import { createSendEnvelope } from "./room-socket-local-media-send"
import { createLocalMediaSfuSession } from "./room-socket-local-media-sfu"

/**
 * Local-media lifecycle for one WebSocket (boot → active → teardown).
 * Reconnect/dispose stay in {@link createRoomSocketConnection}.
 */
export type RoomSocketLocalMediaSession = {
  /** true if the envelope was a local-media / SFU / P2P message. */
  handleEnvelope: (envelope: WsEnvelope<string, unknown>) => boolean
  bootstrapAfterFirstSnapshot: (payload: RoomSnapshotPayload) => void
  /** Queues until SFU caps are ready. */
  provideViaSfu: (localMediaId: string) => void
  onSocketClose: () => void
}

/** Call `bootstrapAfterFirstSnapshot` after the first snapshot; `onSocketClose` from `onclose` (before reconnect). */
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
    handleEnvelope,
    bootstrapAfterFirstSnapshot,
    provideViaSfu: sfu.provideViaSfu,
    onSocketClose,
  }
}
