import { env } from "@/env"
import {
  getPublicHostname,
  MEDIASOUP_RTC_UDP_PORT,
} from "@/shared/public-domain"
import type { types as MsTypes } from "mediasoup"

type Worker = MsTypes.Worker
type Router = MsTypes.Router
type WebRtcServer = MsTypes.WebRtcServer
type WebRtcTransport = MsTypes.WebRtcTransport
type DataProducer = MsTypes.DataProducer

export type LocalMediaSfuProducer = {
  dataProducerId: string
  roomId: string
  ownerUserId: string
}

/** AppData stamped onto WebRtcTransports by signaling handlers. */
export type MediasoupTransportAppData = {
  roomKey: string
  userId?: string
  direction?: "send" | "recv"
  localMediaId?: string
}

/** AppData stamped onto DataProducers (provider block / viewer request). */
export type MediasoupDataProducerAppData = {
  localMediaId?: string
  roomId?: string
  ownerUserId?: string
  userId?: string
  role?: "provider" | "requests"
}

type Runtime = {
  worker: Worker
  webRtcServer: WebRtcServer
  routers: Map<string, Router>
  transports: Map<string, WebRtcTransport>
  dataProducers: Map<string, DataProducer>
  /** Provider block channel per local media id (latest producer wins). */
  localMediaProducers: Map<string, LocalMediaSfuProducer>
  /** Viewer request channels per local media id, keyed by dataProducerId. */
  localMediaRequestProducers: Map<string, Map<string, LocalMediaSfuProducer>>
}

const g = globalThis as typeof globalThis & {
  __webSyncPlayMediasoup?: Runtime | null
  __webSyncPlayMediasoupStarting?: Promise<Runtime | null>
}

type WorkerDiedListener = () => void
const workerDiedListeners = new Set<WorkerDiedListener>()

/** Register a callback when the mediasoup worker process dies. */
export function onMediasoupWorkerDied(listener: WorkerDiedListener) {
  workerDiedListeners.add(listener)
  return () => {
    workerDiedListeners.delete(listener)
  }
}

function notifyWorkerDied() {
  for (const listener of workerDiedListeners) {
    try {
      listener()
    } catch (error) {
      console.error("[mediasoup] worker-died listener failed", error)
    }
  }
}

function clearRuntimeMaps(runtime: Runtime) {
  runtime.localMediaProducers.clear()
  runtime.localMediaRequestProducers.clear()
  runtime.dataProducers.clear()
  runtime.transports.clear()
  runtime.routers.clear()
}

/**
 * Boot mediasoup Worker + single-port WebRtcServer in this process.
 * Always attempted; returns null if the native worker cannot start (e.g. Bun).
 */
export async function ensureMediasoupRuntime(): Promise<Runtime | null> {
  if (g.__webSyncPlayMediasoup) return g.__webSyncPlayMediasoup
  if (g.__webSyncPlayMediasoupStarting) {
    return await g.__webSyncPlayMediasoupStarting
  }

  g.__webSyncPlayMediasoupStarting = (async () => {
    try {
      const mediasoup = await import("mediasoup")
      const worker = await mediasoup.createWorker({
        logLevel: "warn",
      })
      worker.on("died", () => {
        console.error("[mediasoup] worker died")
        const runtime = g.__webSyncPlayMediasoup
        g.__webSyncPlayMediasoup = null
        if (runtime) clearRuntimeMaps(runtime)
        notifyWorkerDied()
      })

      const announced = getPublicHostname()
      const webRtcServer = await worker.createWebRtcServer({
        listenInfos: [
          {
            protocol: "udp",
            ip: "0.0.0.0",
            port: MEDIASOUP_RTC_UDP_PORT,
            ...(announced ? { announcedAddress: announced } : {}),
          },
        ],
      })

      const runtime: Runtime = {
        worker,
        webRtcServer,
        routers: new Map(),
        transports: new Map(),
        dataProducers: new Map(),
        localMediaProducers: new Map(),
        localMediaRequestProducers: new Map(),
      }
      g.__webSyncPlayMediasoup = runtime
      console.info("[mediasoup] in-process SFU ready", {
        pid: worker.pid,
        rtcPort: MEDIASOUP_RTC_UDP_PORT,
        announced:
          announced ||
          `(unset — set PUBLIC_DOMAIN for ICE behind NAT; env=${env.NODE_ENV})`,
      })
      return runtime
    } catch (error) {
      console.warn(
        "[mediasoup] SFU not started (HTTP local-media relay still works)",
        error instanceof Error ? error.message : error,
      )
      g.__webSyncPlayMediasoup = null
      return null
    } finally {
      g.__webSyncPlayMediasoupStarting = undefined
    }
  })()

  return await g.__webSyncPlayMediasoupStarting
}

export function isMediasoupSfuConfigured(): boolean {
  return g.__webSyncPlayMediasoup != null
}

async function requireRuntime() {
  const runtime = await ensureMediasoupRuntime()
  if (!runtime) throw new Error("mediasoup_sfu_unconfigured")
  return runtime
}

async function getOrCreateRouter(roomKey: string) {
  const runtime = await requireRuntime()
  const existing = runtime.routers.get(roomKey)
  if (existing) return existing
  const router = await runtime.worker.createRouter({ mediaCodecs: [] })
  runtime.routers.set(roomKey, router)
  return router
}

export async function mediasoupCreateRouter(roomKey: string) {
  const router = await getOrCreateRouter(roomKey)
  return {
    roomKey,
    routerId: router.id,
    rtpCapabilities: router.rtpCapabilities,
  }
}

export async function mediasoupCreateTransport(
  roomKey: string,
  appData: Omit<MediasoupTransportAppData, "roomKey"> = {},
) {
  const runtime = await requireRuntime()
  const router = await getOrCreateRouter(roomKey)
  const transportAppData: MediasoupTransportAppData = { ...appData, roomKey }
  const transport = await router.createWebRtcTransport({
    webRtcServer: runtime.webRtcServer,
    enableUdp: true,
    enableTcp: false,
    preferUdp: true,
    enableSctp: true,
    appData: transportAppData,
  })
  runtime.transports.set(transport.id, transport)
  transport.observer.once("close", () => {
    runtime.transports.delete(transport.id)
  })
  return {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
    sctpParameters: transport.sctpParameters,
  }
}

export async function mediasoupConnectTransport(input: {
  transportId: string
  dtlsParameters: MsTypes.DtlsParameters
}) {
  const runtime = await requireRuntime()
  const transport = runtime.transports.get(input.transportId)
  if (!transport) throw new Error("transport_not_found")
  await transport.connect({ dtlsParameters: input.dtlsParameters })
  return { ok: true as const }
}

export async function mediasoupProduceData(input: {
  transportId: string
  sctpStreamParameters: MsTypes.SctpStreamParameters
  label?: string
  protocol?: string
  appData?: MediasoupDataProducerAppData
}) {
  const runtime = await requireRuntime()
  const transport = runtime.transports.get(input.transportId)
  if (!transport) throw new Error("transport_not_found")
  const appData: MediasoupDataProducerAppData = input.appData || {}
  const dataProducer = await transport.produceData({
    sctpStreamParameters: input.sctpStreamParameters,
    label: input.label || "web-syncplay-local-media",
    protocol: input.protocol || "",
    appData,
  })
  runtime.dataProducers.set(dataProducer.id, dataProducer)

  const localMediaId = appData.localMediaId ?? null
  const roomId = appData.roomId ?? ""
  const ownerUserId = appData.ownerUserId ?? ""
  const isRequestChannel = appData.role === "requests"

  if (localMediaId) {
    const entry: LocalMediaSfuProducer = {
      dataProducerId: dataProducer.id,
      roomId,
      ownerUserId,
    }
    if (isRequestChannel) {
      const byProducer =
        runtime.localMediaRequestProducers.get(localMediaId) ?? new Map()
      byProducer.set(dataProducer.id, entry)
      runtime.localMediaRequestProducers.set(localMediaId, byProducer)
    } else {
      runtime.localMediaProducers.set(localMediaId, entry)
    }
  }

  dataProducer.observer.once("close", () => {
    runtime.dataProducers.delete(dataProducer.id)
    if (!localMediaId) return
    if (isRequestChannel) {
      const byProducer = runtime.localMediaRequestProducers.get(localMediaId)
      byProducer?.delete(dataProducer.id)
      if (byProducer?.size === 0) {
        runtime.localMediaRequestProducers.delete(localMediaId)
      }
      return
    }
    // A newer producer may have replaced this one; only clear if still current.
    if (
      runtime.localMediaProducers.get(localMediaId)?.dataProducerId ===
      dataProducer.id
    ) {
      runtime.localMediaProducers.delete(localMediaId)
    }
  })

  return { id: dataProducer.id }
}

/** Provider block channel for a local media id, if one is live. */
export function getLocalMediaSfuProducer(
  localMediaId: string,
): LocalMediaSfuProducer | null {
  return g.__webSyncPlayMediasoup?.localMediaProducers.get(localMediaId) ?? null
}

/** Viewer request channels currently live for a local media id. */
export function listLocalMediaSfuRequestProducers(
  localMediaId: string,
): LocalMediaSfuProducer[] {
  const byProducer =
    g.__webSyncPlayMediasoup?.localMediaRequestProducers.get(localMediaId)
  return byProducer ? [...byProducer.values()] : []
}

/** All registered provider channels (diagnostics / tests). */
export function listLocalMediaSfuProducers(): Array<
  LocalMediaSfuProducer & { localMediaId: string }
> {
  const runtime = g.__webSyncPlayMediasoup
  if (!runtime) return []
  return [...runtime.localMediaProducers].map(([localMediaId, entry]) => ({
    localMediaId,
    ...entry,
  }))
}

/** Drop registry entries and close the DataProducer(s) for a media id. */
export function clearLocalMediaSfuProducer(localMediaId: string) {
  const runtime = g.__webSyncPlayMediasoup
  if (!runtime) return
  const provider = runtime.localMediaProducers.get(localMediaId)
  runtime.localMediaProducers.delete(localMediaId)
  if (provider) runtime.dataProducers.get(provider.dataProducerId)?.close()
  const requests = runtime.localMediaRequestProducers.get(localMediaId)
  runtime.localMediaRequestProducers.delete(localMediaId)
  for (const id of requests?.keys() ?? []) {
    runtime.dataProducers.get(id)?.close()
  }
}

/**
 * Close a single DataProducer. Observer hooks unregister it without wiping
 * sibling request/provider channels for the same media id.
 */
export function closeLocalMediaSfuDataProducer(producerId: string) {
  g.__webSyncPlayMediasoup?.dataProducers.get(producerId)?.close()
}

/** Test helper: fire worker-died listeners without mutating a live runtime. */
export function notifyMediasoupWorkerDiedForTests() {
  notifyWorkerDied()
}

export function getMediasoupTransportAppData(
  transportId: string,
): MediasoupTransportAppData | null {
  const appData =
    g.__webSyncPlayMediasoup?.transports.get(transportId)?.appData
  if (!appData || typeof appData.roomKey !== "string") return null
  return appData as MediasoupTransportAppData
}

export function getMediasoupDataProducerAppData(
  dataProducerId: string,
): MediasoupDataProducerAppData | null {
  const appData =
    g.__webSyncPlayMediasoup?.dataProducers.get(dataProducerId)?.appData
  if (!appData) return null
  return appData as MediasoupDataProducerAppData
}

export function mediasoupCloseTransport(transportId: string) {
  g.__webSyncPlayMediasoup?.transports.get(transportId)?.close()
}

/** Run `callback` once when the transport closes (immediately if already gone). */
export function onMediasoupTransportClosed(
  transportId: string,
  callback: () => void,
) {
  const transport = g.__webSyncPlayMediasoup?.transports.get(transportId)
  if (!transport || transport.closed) {
    callback()
    return
  }
  transport.observer.once("close", callback)
}

export async function mediasoupConsumeData(input: {
  transportId: string
  dataProducerId: string
}) {
  const runtime = await requireRuntime()
  const transport = runtime.transports.get(input.transportId)
  const dataProducer = runtime.dataProducers.get(input.dataProducerId)
  if (!transport || !dataProducer) throw new Error("not_found")
  const dataConsumer = await transport.consumeData({
    dataProducerId: dataProducer.id,
  })
  return {
    id: dataConsumer.id,
    dataProducerId: dataProducer.id,
    sctpStreamParameters: dataConsumer.sctpStreamParameters,
    label: dataConsumer.label,
    protocol: dataConsumer.protocol,
  }
}
