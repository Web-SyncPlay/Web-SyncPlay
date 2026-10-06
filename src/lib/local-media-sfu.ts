/**
 * mediasoup DataChannel SFU path for local-media block delivery.
 *
 * mediasoup DataProducers/DataConsumers are one-way, so each media id uses two
 * channels through the SFU:
 *  - provider block channel: provider DataProducer -> every viewer DataConsumer
 *  - viewer request channel: viewer DataProducer -> provider DataConsumer
 * The wire protocol matches the P2P mesh (`lm-block-req` / `lm-block-meta`),
 * except binary frames are prefixed with the 36-char request id so that
 * responses to other viewers can be skipped cheaply.
 *
 * Signaling goes over the room WebSocket via the caller-supplied `sendRequest`.
 */

import { getLocalMediaFile } from "@/lib/local-media-provider"
import type { ClientEventType } from "@/lib/room-events"
import { Device, type types as MsTypes } from "mediasoup-client"

const BLOCK_REQUEST = "lm-block-req"
const BLOCK_META = "lm-block-meta"
/**
 * mediasoup drops messages sent before the provider's DataConsumer exists, so
 * the provider acks on its block channel once it is consuming a viewer's
 * request channel; viewers must not send requests before this arrives.
 */
const READY_ACK = "lm-sfu-ready"
const CHANNEL_LABEL = "web-syncplay-local-media"
const REQUEST_ID_LENGTH = 36
const MAX_FRAME_PAYLOAD = 60 * 1024
const MAX_BLOCK_BYTES = 256 * 1024
const BUFFER_HIGH_WATER = 1024 * 1024
const OPEN_TIMEOUT_MS = 8_000
const ENSURE_RETRY_COOLDOWN_MS = 3_000

export type SfuRequestType = Extract<ClientEventType, `local-media:sfu:${string}`>

export type SfuResult = { ok: boolean; error?: string } & Record<
  string,
  unknown
>

/** Sends a `local-media:sfu:*` WS request and resolves with the correlated result. */
export type SfuSendRequest = (
  type: SfuRequestType,
  payload: Record<string, unknown>,
) => Promise<SfuResult>

type PendingBlock = {
  resolve: (bytes: Uint8Array | null) => void
  timer: ReturnType<typeof setTimeout>
  buffer: Uint8Array | null
  received: number
}

type ProviderSlot = {
  producer: MsTypes.DataProducer
  consumers: Map<string, MsTypes.DataConsumer>
  queue: Promise<void>
}

type ViewerSlot = {
  consumer: MsTypes.DataConsumer
  requestProducer: MsTypes.DataProducer
  pending: Map<string, PendingBlock>
  ready: boolean
  readyWaiter: { resolve: () => void; reject: (error: Error) => void } | null
}

type Session = {
  sendRequest: SfuSendRequest
  device: Promise<Device> | null
  sendTransport: Promise<MsTypes.Transport> | null
  recvTransport: Promise<MsTypes.Transport> | null
  providers: Map<string, Promise<ProviderSlot | null>>
  viewers: Map<string, Promise<ViewerSlot | null>>
  /** Synchronously readable view of viewers whose provider ack has arrived. */
  readyViewers: Map<string, ViewerSlot>
  requestProducers: Map<string, Array<{ dataProducerId: string }>>
  lastFailure: Map<string, number>
}

const g = globalThis as typeof globalThis & {
  __webSyncPlayLocalMediaSfu?: Session | null
}

function newSession(sendRequest: SfuSendRequest): Session {
  return {
    sendRequest,
    device: null,
    sendTransport: null,
    recvTransport: null,
    providers: new Map(),
    viewers: new Map(),
    readyViewers: new Map(),
    requestProducers: new Map(),
    lastFailure: new Map(),
  }
}

function sessionFor(sendRequest: SfuSendRequest): Session {
  const current = g.__webSyncPlayLocalMediaSfu
  if (current?.sendRequest === sendRequest) return current
  if (current) disposeSession(current)
  const next = newSession(sendRequest)
  g.__webSyncPlayLocalMediaSfu = next
  return next
}

function disposeSession(session: Session) {
  void session.sendTransport?.then((t) => t.close()).catch(() => {})
  void session.recvTransport?.then((t) => t.close()).catch(() => {})
  session.readyViewers.clear()
  for (const viewer of session.viewers.values()) {
    void viewer.then((slot) => {
      if (!slot) return
      for (const [id, pending] of slot.pending) {
        clearTimeout(pending.timer)
        pending.resolve(null)
        slot.pending.delete(id)
      }
    })
  }
}

/** Register the WS request helper so SW/range fetches can lazily join the SFU. */
export function configureLocalMediaSfu(sendRequest: SfuSendRequest) {
  sessionFor(sendRequest)
}

/**
 * Tear down transports and channels (call when the room socket closes).
 * Pass the closing socket's `sendRequest` so a newer session is left alone.
 */
export function closeLocalMediaSfu(sendRequest?: SfuSendRequest) {
  const current = g.__webSyncPlayLocalMediaSfu
  if (!current) return
  if (sendRequest && current.sendRequest !== sendRequest) return
  g.__webSyncPlayLocalMediaSfu = null
  disposeSession(current)
}

async function call(
  session: Session,
  type: SfuRequestType,
  payload: Record<string, unknown>,
): Promise<SfuResult> {
  const result = await session.sendRequest(type, payload)
  if (!result.ok) throw new Error(result.error ?? "sfu_request_failed")
  return result
}

function getDevice(session: Session): Promise<Device> {
  if (!session.device) {
    const promise = (async () => {
      const caps = await call(session, "local-media:sfu:capabilities", {})
      const device = await Device.factory()
      await device.load({
        routerRtpCapabilities:
          caps.routerRtpCapabilities as MsTypes.RtpCapabilities,
      })
      return device
    })()
    session.device = promise
    promise.catch(() => {
      if (session.device === promise) session.device = null
    })
  }
  return session.device
}

function getTransport(
  session: Session,
  direction: "send" | "recv",
): Promise<MsTypes.Transport> {
  const cached =
    direction === "send" ? session.sendTransport : session.recvTransport
  if (cached) return cached

  const promise = (async () => {
    const device = await getDevice(session)
    const info = await call(session, "local-media:sfu:create-transport", {
      direction,
    })
    const options = {
      id: info.id as string,
      iceParameters: info.iceParameters as MsTypes.IceParameters,
      iceCandidates: info.iceCandidates as MsTypes.IceCandidate[],
      dtlsParameters: info.dtlsParameters as MsTypes.DtlsParameters,
      sctpParameters: info.sctpParameters as MsTypes.SctpParameters,
    }
    const transport =
      direction === "send"
        ? device.createSendTransport(options)
        : device.createRecvTransport(options)

    transport.on("connect", ({ dtlsParameters }, callback, errback) => {
      call(session, "local-media:sfu:connect-transport", {
        transportId: transport.id,
        dtlsParameters,
      })
        .then(() => callback())
        .catch(errback)
    })

    if (direction === "send") {
      transport.on(
        "producedata",
        ({ sctpStreamParameters, label, protocol, appData }, callback, errback) => {
          const localMediaId = appData.localMediaId as string
          const role = (appData.role as string | undefined) ?? "provider"
          call(session, "local-media:sfu:produce-data", {
            transportId: transport.id,
            localMediaId,
            sctpStreamParameters,
            label,
            protocol,
            role,
          })
            .then((result) => {
              if (role === "provider") {
                session.requestProducers.set(
                  localMediaId,
                  (result.requestProducers as
                    | Array<{ dataProducerId: string }>
                    | undefined) ?? [],
                )
              }
              callback({ id: result.id as string })
            })
            .catch(errback)
        },
      )
    }

    transport.on("connectionstatechange", (state) => {
      if (state !== "failed" && state !== "closed") return
      const slotKey = direction === "send" ? "sendTransport" : "recvTransport"
      if (session[slotKey] === promise) session[slotKey] = null
      if (state === "failed") transport.close()
    })

    return transport
  })()

  if (direction === "send") session.sendTransport = promise
  else session.recvTransport = promise
  promise.catch(() => {
    const slotKey = direction === "send" ? "sendTransport" : "recvTransport"
    if (session[slotKey] === promise) session[slotKey] = null
  })
  return promise
}

function waitForOpen(channel: MsTypes.DataProducer) {
  if (channel.readyState === "open") return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("sfu_channel_open_timeout")),
      OPEN_TIMEOUT_MS,
    )
    channel.once("open", () => {
      clearTimeout(timer)
      resolve()
    })
    const onClosed = () => {
      clearTimeout(timer)
      reject(new Error("sfu_channel_closed"))
    }
    channel.once("close", onClosed)
    channel.once("transportclose", onClosed)
  })
}

function toArrayBuffer(data: unknown): ArrayBuffer | null {
  if (data instanceof ArrayBuffer) return data
  if (ArrayBuffer.isView(data)) {
    const copy = new Uint8Array(data.byteLength)
    copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
    return copy.buffer
  }
  return null
}

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

async function waitForDrain(producer: MsTypes.DataProducer) {
  producer.bufferedAmountLowThreshold = BUFFER_HIGH_WATER / 2
  while (producer.bufferedAmount > BUFFER_HIGH_WATER) {
    if (producer.closed) throw new Error("sfu_channel_closed")
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 50)
      producer.once("bufferedamountlow", () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
}

async function serveBlockRequest(
  producer: MsTypes.DataProducer,
  localMediaId: string,
  msg: { requestId?: string; start?: number; end?: number },
) {
  const { requestId, start, end } = msg
  const fail = (error: string) => {
    producer.send(
      JSON.stringify({ t: BLOCK_META, requestId, ok: false, error }),
    )
  }

  const file = getLocalMediaFile(localMediaId)
  if (
    !file ||
    typeof requestId !== "string" ||
    requestId.length !== REQUEST_ID_LENGTH ||
    typeof start !== "number" ||
    typeof end !== "number" ||
    start < 0 ||
    end < start
  ) {
    fail("provider_unavailable")
    return
  }
  if (end - start + 1 > MAX_BLOCK_BYTES) {
    fail("range_too_large")
    return
  }

  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.slice(start, end + 1).arrayBuffer())
  } catch {
    fail("read_failed")
    return
  }

  producer.send(
    JSON.stringify({
      t: BLOCK_META,
      requestId,
      ok: true,
      byteLength: bytes.byteLength,
    }),
  )

  const header = new TextEncoder().encode(requestId)
  for (let offset = 0; offset < bytes.byteLength; offset += MAX_FRAME_PAYLOAD) {
    await waitForDrain(producer)
    const chunk = bytes.subarray(
      offset,
      Math.min(offset + MAX_FRAME_PAYLOAD, bytes.byteLength),
    )
    const frame = new Uint8Array(header.byteLength + chunk.byteLength)
    frame.set(header, 0)
    frame.set(chunk, header.byteLength)
    producer.send(frame)
  }
}

function attachRequestConsumer(
  slot: ProviderSlot,
  localMediaId: string,
  consumer: MsTypes.DataConsumer,
) {
  consumer.binaryType = "arraybuffer"
  slot.consumers.set(consumer.dataProducerId, consumer)
  const onClosed = () => {
    if (slot.consumers.get(consumer.dataProducerId) === consumer) {
      slot.consumers.delete(consumer.dataProducerId)
    }
  }
  consumer.on("close", onClosed)
  consumer.on("transportclose", onClosed)
  consumer.on("message", (message: unknown) => {
    if (typeof message !== "string") return
    const msg = parseJson<{
      t?: string
      requestId?: string
      start?: number
      end?: number
    }>(message)
    if (msg?.t !== BLOCK_REQUEST) return
    slot.queue = slot.queue
      .then(() => serveBlockRequest(slot.producer, localMediaId, msg))
      .catch((error) => {
        console.warn("[local-media-sfu] serve failed", error)
      })
  })
}

async function consumeRequestChannel(
  session: Session,
  slot: ProviderSlot,
  localMediaId: string,
  dataProducerId: string,
) {
  if (slot.consumers.has(dataProducerId)) return
  const recv = await getTransport(session, "recv")
  const info = await call(session, "local-media:sfu:consume-data", {
    transportId: recv.id,
    localMediaId,
    dataProducerId,
  })
  const consumer = await recv.consumeData({
    id: info.id as string,
    dataProducerId: info.dataProducerId as string,
    sctpStreamParameters:
      info.sctpStreamParameters as MsTypes.SctpStreamParameters,
    label: info.label as string | undefined,
    protocol: info.protocol as string | undefined,
  })
  attachRequestConsumer(slot, localMediaId, consumer)
  try {
    slot.producer.send(JSON.stringify({ t: READY_ACK, dataProducerId }))
  } catch (error) {
    console.warn("[local-media-sfu] ready ack failed", error)
  }
}

/**
 * Provider: publish a block channel for this File and answer viewer requests
 * with slices from {@link getLocalMediaFile}.
 */
export function ensureLocalMediaSfuProvider(
  localMediaId: string,
  sendRequest: SfuSendRequest,
): Promise<boolean> {
  const session = sessionFor(sendRequest)
  if (!getLocalMediaFile(localMediaId)) return Promise.resolve(false)

  let promise = session.providers.get(localMediaId)
  if (!promise) {
    promise = (async (): Promise<ProviderSlot | null> => {
      try {
        const send = await getTransport(session, "send")
        const producer = await send.produceData({
          ordered: true,
          label: CHANNEL_LABEL,
          appData: { localMediaId, role: "provider" },
        })
        const slot: ProviderSlot = {
          producer,
          consumers: new Map(),
          queue: Promise.resolve(),
        }
        const onProducerClosed = () => {
          if (session.providers.get(localMediaId) === promise) {
            session.providers.delete(localMediaId)
          }
          session.requestProducers.delete(localMediaId)
          slot.consumers.clear()
        }
        producer.on("close", onProducerClosed)
        producer.on("transportclose", onProducerClosed)
        await waitForOpen(producer)

        const existing = session.requestProducers.get(localMediaId) ?? []
        await Promise.all(
          existing.map((entry) =>
            consumeRequestChannel(
              session,
              slot,
              localMediaId,
              entry.dataProducerId,
            ).catch((error) => {
              console.warn("[local-media-sfu] request consume failed", error)
            }),
          ),
        )
        return slot
      } catch (error) {
        console.warn("[local-media-sfu] provider setup failed", error)
        session.providers.delete(localMediaId)
        return null
      }
    })()
    session.providers.set(localMediaId, promise)
  }
  return promise.then((slot) => slot != null)
}

/** Provider: a viewer published a request channel for media we hold. */
export async function ensureLocalMediaSfuRequestConsumer(
  localMediaId: string,
  dataProducerId: string,
  sendRequest: SfuSendRequest,
): Promise<void> {
  const session = sessionFor(sendRequest)
  const slot = await session.providers.get(localMediaId)
  if (!slot) return
  try {
    await consumeRequestChannel(session, slot, localMediaId, dataProducerId)
  } catch (error) {
    console.warn("[local-media-sfu] request consume failed", error)
  }
}

function parseReadyAck(message: unknown): string | null {
  if (typeof message !== "string") return null
  const msg = parseJson<{ t?: string; dataProducerId?: string }>(message)
  if (msg?.t !== READY_ACK || typeof msg.dataProducerId !== "string") {
    return null
  }
  return msg.dataProducerId
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
    const msg = parseJson<{
      t?: string
      requestId?: string
      ok?: boolean
      byteLength?: number
    }>(message)
    if (msg?.t !== BLOCK_META || !msg.requestId) return
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
  if (!buffer || buffer.byteLength < REQUEST_ID_LENGTH) return
  const frame = new Uint8Array(buffer)
  const requestId = new TextDecoder().decode(
    frame.subarray(0, REQUEST_ID_LENGTH),
  )
  const pending = slot.pending.get(requestId)
  if (!pending?.buffer) return
  const payload = frame.subarray(REQUEST_ID_LENGTH)
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
          label: CHANNEL_LABEL,
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
  const session = g.__webSyncPlayLocalMediaSfu
  if (!session || getLocalMediaFile(localMediaId)) return false
  return readyViewerSlot(session, localMediaId) != null
}

/** Fire-and-forget viewer setup (respects the failure cooldown). */
export function warmLocalMediaSfuViewer(localMediaId: string) {
  const session = g.__webSyncPlayLocalMediaSfu
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
  const session = g.__webSyncPlayLocalMediaSfu
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
        JSON.stringify({ t: BLOCK_REQUEST, requestId, start, end }),
      )
    } catch {
      slot.pending.delete(requestId)
      clearTimeout(timer)
      resolve(null)
    }
  })
}
