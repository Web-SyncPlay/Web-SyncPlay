"use client"

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

/**
 * Local-media socket lifecycle facade.
 *
 * Collapses `room-socket-local-media-*` behind three phases. Wire protocol
 * (envelope types / payloads) is unchanged — this is structure only.
 *
 * | Phase     | Public entry                         | Internals |
 * |-----------|--------------------------------------|-----------|
 * | **boot**  | construct + {@link RoomSocketLocalMediaSession.bootstrapAfterFirstSnapshot} | send, SFU session, runtime, bootstrap (caps / SW / restore / ABR / P2P invite) |
 * | **active**| {@link RoomSocketLocalMediaSession.handleEnvelope}, {@link RoomSocketLocalMediaSession.provideViaSfu} | handlers, read, P2P signal, SFU producer announce |
 * | **teardown** | {@link RoomSocketLocalMediaSession.onSocketClose} | abort boot, detach SW, flush SFU, close runtime |
 *
 * Reconnect / dispose stay in {@link createRoomSocketConnection}; this facade
 * owns local-media resources for one WebSocket instance only.
 */
export type RoomSocketLocalMediaSession = {
  /** active: consume local-media / SFU / P2P envelopes; true if handled. */
  handleEnvelope: (envelope: WsEnvelope<string, unknown>) => boolean
  /** boot: first-snapshot SFU caps, SW bridge, handle restore, ABR, P2P invite. */
  bootstrapAfterFirstSnapshot: (payload: RoomSnapshotPayload) => void
  /** active: publish owned local media on the SFU (queues until caps ready). */
  provideViaSfu: (localMediaId: string) => void
  /** teardown: abort in-flight boot and release runtime / SFU / SW bridge. */
  onSocketClose: () => void
}

/**
 * Construct a local-media lifecycle session for one open WebSocket.
 * Call {@link RoomSocketLocalMediaSession.bootstrapAfterFirstSnapshot} after the
 * first room snapshot; call {@link RoomSocketLocalMediaSession.onSocketClose} from
 * the socket `onclose` path (before reconnect).
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

  // --- boot (construction): wire send / SFU / runtime / handlers ---
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

  // --- active: envelope routing + SFU provide ---
  const handleEnvelope = createLocalMediaEnvelopeHandler({
    sfu,
    handleLocalMediaRead,
    handleWebrtcSignal,
    handleReannounce: () => handleReannounce(bootstrapAbort?.signal),
  })

  // --- boot (first snapshot): cancel prior boot, then run bootstrap ---
  const bootstrapAfterFirstSnapshot = (payload: RoomSnapshotPayload) => {
    bootstrapAbort?.abort()
    bootstrapAbort = new AbortController()
    runBootstrap(payload, bootstrapAbort.signal)
  }

  // --- teardown ---
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
