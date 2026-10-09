"use client"

import type { SfuSendRequest } from "@/lib/local-media-sfu"
import type {
  RoomSnapshotPayload,
  RoomState,
  WsEnvelope,
} from "@/zod/types"
import type { MutableRefObject } from "react"
import { createLocalMediaBootstrap } from "./room-socket-local-media-bootstrap"
import { createLocalMediaEnvelopeHandler } from "./room-socket-local-media-handlers"
import { createLocalMediaWebrtcSignalHandler } from "./room-socket-local-media-p2p"
import { createLocalMediaReadHandler } from "./room-socket-local-media-read"
import { createSendEnvelope } from "./room-socket-local-media-send"
import { createLocalMediaSfuSession } from "./room-socket-local-media-sfu"

type LocalMediaSocketSession = {
  sendSfuRequest: SfuSendRequest
  provideViaSfu: (localMediaId: string) => void
  /** Returns true when the envelope was handled as a local-media message. */
  handleEnvelope: (envelope: WsEnvelope<string, unknown>) => boolean
  bootstrapAfterFirstSnapshot: (payload: RoomSnapshotPayload) => void
  onSocketClose: () => void
}

/**
 * Owns SFU request correlation, local-media wire handlers, and the
 * first-snapshot bootstrap (restore handles, SW bridge, ABR republish).
 * Keeps reconnect semantics in the caller — this only tears down SFU state.
 */
export function createRoomSocketLocalMediaSession(input: {
  ws: WebSocket
  roomId: string
  userId: string
  roomStateRef: MutableRefObject<RoomState | null>
  getDetachSwBridge: () => (() => void) | null
  setDetachSwBridge: (detach: (() => void) | null) => void
}): LocalMediaSocketSession {
  const { ws, roomId, userId, roomStateRef } = input

  const sendEnvelope = createSendEnvelope(ws)
  const sfu = createLocalMediaSfuSession({ ws, userId })
  const handleLocalMediaRead = createLocalMediaReadHandler(ws)
  const handleWebrtcSignal = createLocalMediaWebrtcSignalHandler()

  const { bootstrapAfterFirstSnapshot, handleReannounce } =
    createLocalMediaBootstrap({
      ws,
      roomId,
      userId,
      roomStateRef,
      getDetachSwBridge: input.getDetachSwBridge,
      setDetachSwBridge: input.setDetachSwBridge,
      sendEnvelope,
      sfu,
    })

  const handleEnvelope = createLocalMediaEnvelopeHandler({
    sfu,
    handleLocalMediaRead,
    handleWebrtcSignal,
    handleReannounce,
  })

  const onSocketClose = () => {
    sfu.markSfuUnavailable()
    input.getDetachSwBridge()?.()
    input.setDetachSwBridge(null)
    sfu.flushSfuPending()
    void import("@/lib/local-media-sfu").then(({ closeLocalMediaSfu }) =>
      closeLocalMediaSfu(sfu.sendSfuRequest),
    )
  }

  return {
    sendSfuRequest: sfu.sendSfuRequest,
    provideViaSfu: sfu.provideViaSfu,
    handleEnvelope,
    bootstrapAfterFirstSnapshot,
    onSocketClose,
  }
}
