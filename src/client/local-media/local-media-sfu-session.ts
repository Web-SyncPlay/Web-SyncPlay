/**
 * mediasoup SFU session: device, transports, and process-wide singleton.
 */

import type { ClientEventType } from "@/contracts/room-events"
import { Device, type types as MsTypes } from "mediasoup-client"

export { ENSURE_RETRY_COOLDOWN_MS } from "./local-media-sfu-transitions"

export const BUFFER_HIGH_WATER = 1024 * 1024
export const OPEN_TIMEOUT_MS = 8_000

export type SfuRequestType = Extract<
  ClientEventType,
  `local-media:sfu:${string}`
>

export type SfuResult = { ok: boolean; error?: string } & Record<
  string,
  unknown
>

/** Sends a `local-media:sfu:*` WS request and resolves with the correlated result. */
export type SfuSendRequest = (
  type: SfuRequestType,
  payload: Record<string, unknown>,
) => Promise<SfuResult>

export type PendingBlock = {
  resolve: (bytes: Uint8Array | null) => void
  timer: ReturnType<typeof setTimeout>
  buffer: Uint8Array | null
  received: number
}

export type ProviderSlot = {
  producer: MsTypes.DataProducer
  consumers: Map<string, MsTypes.DataConsumer>
  queue: Promise<void>
}

export type ViewerSlot = {
  consumer: MsTypes.DataConsumer
  requestProducer: MsTypes.DataProducer
  pending: Map<string, PendingBlock>
  ready: boolean
  readyWaiter: { resolve: () => void; reject: (error: Error) => void } | null
}

export type Session = {
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

export function sessionFor(sendRequest: SfuSendRequest): Session {
  const current = g.__webSyncPlayLocalMediaSfu
  if (current?.sendRequest === sendRequest) return current
  if (current) disposeSession(current)
  const next = newSession(sendRequest)
  g.__webSyncPlayLocalMediaSfu = next
  return next
}

export function getActiveSession(): Session | null {
  return g.__webSyncPlayLocalMediaSfu ?? null
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

export async function call(
  session: Session,
  type: SfuRequestType,
  payload: Record<string, unknown>,
): Promise<SfuResult> {
  const result = await session.sendRequest(type, payload)
  if (!result.ok) throw new Error(result.error ?? "sfu_request_failed")
  return result
}

export function getDevice(session: Session): Promise<Device> {
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

export function getTransport(
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
        (
          { sctpStreamParameters, label, protocol, appData },
          callback,
          errback,
        ) => {
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

export function waitForOpen(channel: MsTypes.DataProducer) {
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

export function toArrayBuffer(data: unknown): ArrayBuffer | null {
  if (data instanceof ArrayBuffer) return data
  if (ArrayBuffer.isView(data)) {
    const copy = new Uint8Array(data.byteLength)
    copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
    return copy.buffer
  }
  return null
}
