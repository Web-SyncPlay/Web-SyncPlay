/**
 * mediasoup SFU viewer path: consume blocks and request ranges.
 */

import {
  encodeLocalMediaBlockRequest,
  isLocalMediaBlockMeta,
  LOCAL_MEDIA_BLOCK_CHANNEL_LABEL,
  LOCAL_MEDIA_BLOCK_REQUEST_ID_LENGTH,
  parseLocalMediaBlockJson,
  parseLocalMediaSfuReadyAck,
} from "@/lib/local-media-block-protocol"
import { getLocalMediaFile } from "@/lib/local-media-provider"
import type { types as MsTypes } from "mediasoup-client"
import {
  call,
  ENSURE_RETRY_COOLDOWN_MS,
  getActiveSession,
  getTransport,
  OPEN_TIMEOUT_MS,
  sessionFor,
  toArrayBuffer,
  waitForOpen,
  type Session,
  type SfuSendRequest,
  type ViewerSlot,
} from "./local-media-sfu-session"

function parseReadyAck(message: unknown): string | null {
  if (typeof message !== "string") return null
  return parseLocalMediaSfuReadyAck(message)
}

function markViewerReady(slot: ViewerSlot) {
  slot.ready = true
  const waiter = slot.readyWaiter
  slot.readyWaiter = null
  waiter?.resolve()
}

function waitForReady(slot: ViewerSlot) {
  if (slot.ready) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      slot.readyWaiter = null
      reject(new Error("sfu_ready_timeout"))
    }, OPEN_TIMEOUT_MS)
    slot.readyWaiter = {
      resolve: () => {
        clearTimeout(timer)
        resolve()
      },
      reject: (error) => {
        clearTimeout(timer)
        reject(error)
      },
    }
  })
}

function handleViewerMessage(slot: ViewerSlot, message: unknown) {
  if (typeof message === "string") {
    const ackedProducerId = parseReadyAck(message)
    if (ackedProducerId) {
      if (ackedProducerId === slot.requestProducer.id) markViewerReady(slot)
      return
    }
    const msg = parseLocalMediaBlockJson(message)
    if (!isLocalMediaBlockMeta(msg) || !msg.requestId) return
    const pending = slot.pending.get(msg.requestId)
    if (!pending) return
    if (!msg.ok || typeof msg.byteLength !== "number") {
      slot.pending.delete(msg.requestId)
      clearTimeout(pending.timer)
      pending.resolve(null)
      return
    }
    pending.buffer = new Uint8Array(msg.byteLength)
    if (msg.byteLength === 0) {
      slot.pending.delete(msg.requestId)
      clearTimeout(pending.timer)
      pending.resolve(pending.buffer)
    }
    return
  }

  const buffer = toArrayBuffer(message)
  if (!buffer || buffer.byteLength < LOCAL_MEDIA_BLOCK_REQUEST_ID_LENGTH) return
  const frame = new Uint8Array(buffer)
  const requestId = new TextDecoder().decode(
    frame.subarray(0, LOCAL_MEDIA_BLOCK_REQUEST_ID_LENGTH),
  )
  const pending = slot.pending.get(requestId)
  if (!pending?.buffer) return
  const payload = frame.subarray(LOCAL_MEDIA_BLOCK_REQUEST_ID_LENGTH)
  if (pending.received + payload.byteLength > pending.buffer.byteLength) {
    slot.pending.delete(requestId)
    clearTimeout(pending.timer)
    pending.resolve(null)
    return
  }
  pending.buffer.set(payload, pending.received)
  pending.received += payload.byteLength
  if (pending.received === pending.buffer.byteLength) {
    slot.pending.delete(requestId)
    clearTimeout(pending.timer)
    pending.resolve(pending.buffer)
  }
}

/**
 * Viewer: consume the provider's block channel and open a request channel
 * back to the provider. Resolves false when no SFU producer exists yet.
 */
export function ensureLocalMediaSfuViewer(
  localMediaId: string,
  sendRequest: SfuSendRequest,
): Promise<boolean> {
  const session = sessionFor(sendRequest)
  if (getLocalMediaFile(localMediaId)) return Promise.resolve(false)

  let promise = session.viewers.get(localMediaId)
  if (!promise) {
    promise = (async (): Promise<ViewerSlot | null> => {
      let consumer: MsTypes.DataConsumer | null = null
      let requestProducer: MsTypes.DataProducer | null = null
      try {
        const recv = await getTransport(session, "recv")
        const info = await call(session, "local-media:sfu:consume-data", {
          transportId: recv.id,
          localMediaId,
        })
        consumer = await recv.consumeData({
          id: info.id as string,
          dataProducerId: info.dataProducerId as string,
          sctpStreamParameters:
            info.sctpStreamParameters as MsTypes.SctpStreamParameters,
          label: info.label as string | undefined,
          protocol: info.protocol as string | undefined,
        })
        consumer.binaryType = "arraybuffer"

        // The provider may ack before produceData resolves here, so buffer
        // acks until the slot (and our request producer id) exists.
        let slot: ViewerSlot | null = null
        const earlyAcks = new Set<string>()
        consumer.on("message", (message: unknown) => {
          if (slot) {
            handleViewerMessage(slot, message)
            return
          }
          const acked = parseReadyAck(message)
          if (acked) earlyAcks.add(acked)
        })

        const send = await getTransport(session, "send")
        requestProducer = await send.produceData({
          ordered: true,
          label: LOCAL_MEDIA_BLOCK_CHANNEL_LABEL,
          appData: { localMediaId, role: "requests" },
        })

        const viewerSlot: ViewerSlot = {
          consumer,
          requestProducer,
          pending: new Map(),
          ready: false,
          readyWaiter: null,
        }
        slot = viewerSlot
        const drop = () => {
          if (session.viewers.get(localMediaId) === promise) {
            session.viewers.delete(localMediaId)
          }
          if (session.readyViewers.get(localMediaId) === viewerSlot) {
            session.readyViewers.delete(localMediaId)
          }
          viewerSlot.ready = false
          viewerSlot.readyWaiter?.reject(new Error("sfu_channel_closed"))
          viewerSlot.readyWaiter = null
          for (const [id, pending] of viewerSlot.pending) {
            clearTimeout(pending.timer)
            pending.resolve(null)
            viewerSlot.pending.delete(id)
          }
        }
        consumer.on("close", drop)
        consumer.on("transportclose", drop)
        requestProducer.on("close", drop)
        requestProducer.on("transportclose", drop)

        await waitForOpen(requestProducer)
        if (earlyAcks.has(requestProducer.id)) markViewerReady(viewerSlot)
        await waitForReady(viewerSlot)
        if (
          !consumer.closed &&
          !requestProducer.closed &&
          session.viewers.get(localMediaId) === promise
        ) {
          session.readyViewers.set(localMediaId, viewerSlot)
        }
        return viewerSlot
      } catch (error) {
        session.lastFailure.set(localMediaId, Date.now())
        session.viewers.delete(localMediaId)
        session.readyViewers.delete(localMediaId)
        requestProducer?.close()
        consumer?.close()
        console.warn("[local-media-sfu] viewer setup failed", error)
        return null
      }
    })()
    session.viewers.set(localMediaId, promise)
  }
  return promise.then((slot) => slot != null)
}

function readyViewerSlot(
  session: Session,
  localMediaId: string,
): ViewerSlot | null {
  const slot = session.readyViewers.get(localMediaId)
  if (!slot || !slot.ready) return null
  if (slot.requestProducer.closed || slot.consumer.closed) return null
  return slot
}

/** True only when a viewer slot has completed the provider ready handshake. */
export function isLocalMediaSfuViewerReady(localMediaId: string): boolean {
  const session = getActiveSession()
  if (!session || getLocalMediaFile(localMediaId)) return false
  return readyViewerSlot(session, localMediaId) != null
}

/** Fire-and-forget viewer setup (respects the failure cooldown). */
export function warmLocalMediaSfuViewer(localMediaId: string) {
  const session = getActiveSession()
  if (!session || getLocalMediaFile(localMediaId)) return
  if (session.viewers.has(localMediaId)) return
  const failedAt = session.lastFailure.get(localMediaId) ?? 0
  if (Date.now() - failedAt < ENSURE_RETRY_COOLDOWN_MS) return
  void ensureLocalMediaSfuViewer(localMediaId, session.sendRequest)
}

/**
 * Range fetch over the SFU; null means the caller should fall back.
 * Never waits for viewer setup: a cold viewer is warmed in the background and
 * this request returns null immediately so the Service Worker is not stalled.
 */
export async function fetchLocalMediaRangeViaSfu(
  localMediaId: string,
  start: number,
  end: number,
  timeoutMs = 5_000,
): Promise<Uint8Array | null> {
  const session = getActiveSession()
  if (!session || getLocalMediaFile(localMediaId)) return null

  const slot = readyViewerSlot(session, localMediaId)
  if (!slot) {
    warmLocalMediaSfuViewer(localMediaId)
    return null
  }

  const requestId = crypto.randomUUID()
  return await new Promise<Uint8Array | null>((resolve) => {
    const timer = setTimeout(() => {
      slot.pending.delete(requestId)
      session.lastFailure.set(localMediaId, Date.now())
      resolve(null)
    }, timeoutMs)
    slot.pending.set(requestId, {
      resolve,
      timer,
      buffer: null,
      received: 0,
    })
    try {
      slot.requestProducer.send(
        encodeLocalMediaBlockRequest(requestId, start, end),
      )
    } catch {
      slot.pending.delete(requestId)
      clearTimeout(timer)
      resolve(null)
    }
  })
}
