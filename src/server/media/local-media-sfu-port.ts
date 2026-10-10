import { getAppNodeId } from "@/server/node-id"
import {
  closeLocalMediaSfuDataProducer,
  ensureMediasoupRuntime,
  getLocalMediaSfuProducer,
  getMediasoupDataProducerAppData,
  getMediasoupTransportAppData,
  listLocalMediaSfuProducers,
  listLocalMediaSfuRequestProducers,
  mediasoupCloseTransport,
  mediasoupConnectTransport,
  mediasoupConsumeData,
  mediasoupCreateRouter,
  mediasoupCreateTransport,
  mediasoupProduceData,
  onMediasoupTransportClosed,
  onMediasoupWorkerDied,
  type LocalMediaSfuProducer,
  type MediasoupDataProducerAppData,
  type MediasoupTransportAppData,
} from "@/server/media/mediasoup-runtime"
import { MEDIASOUP_RTC_UDP_PORT } from "@/shared/public-domain"
import type { types as MsTypes } from "mediasoup"

/**
 * Process-local mediasoup SFU surface for local-media DataChannels.
 *
 * Affinity: SFU routers/transports/producers live only in this process. Sticky
 * `/api/ws` must land provider + SFU viewers on the same replica, and UDP
 * {@link MEDIASOUP_RTC_UDP_PORT} must reach that same process (see README
 * multi-replica SFU notes). When a media entry’s `providerNodeId` is set and
 * differs from {@link getAppNodeId}, signaling must fail with `sfu_wrong_node`
 * rather than silently creating transports that can never deliver bytes.
 */
export interface LocalMediaSfuPort {
  ensureRuntime(): Promise<boolean>
  createRouter(roomId: string): Promise<{
    roomKey: string
    routerId: string
    rtpCapabilities: MsTypes.RtpCapabilities
  }>
  createTransport(
    roomId: string,
    appData?: Omit<MediasoupTransportAppData, "roomKey">,
  ): Promise<{
    id: string
    iceParameters: MsTypes.IceParameters
    iceCandidates: MsTypes.IceCandidate[]
    dtlsParameters: MsTypes.DtlsParameters
    sctpParameters: MsTypes.SctpParameters | undefined
  }>
  connectTransport(input: {
    transportId: string
    dtlsParameters: MsTypes.DtlsParameters
  }): Promise<{ ok: true }>
  produceData(input: {
    transportId: string
    sctpStreamParameters: MsTypes.SctpStreamParameters
    label?: string
    protocol?: string
    appData?: MediasoupDataProducerAppData
  }): Promise<{ id: string }>
  consumeData(input: {
    transportId: string
    dataProducerId: string
  }): Promise<{
    id: string
    dataProducerId: string
    sctpStreamParameters: MsTypes.SctpStreamParameters | undefined
    label: string
    protocol: string
  }>
  closeTransport(transportId: string): void
  onTransportClosed(transportId: string, callback: () => void): void
  getTransportAppData(transportId: string): MediasoupTransportAppData | null
  getDataProducerAppData(
    dataProducerId: string,
  ): MediasoupDataProducerAppData | null
  getProviderProducer(localMediaId: string): LocalMediaSfuProducer | null
  listProviderProducers(): Array<LocalMediaSfuProducer & { localMediaId: string }>
  listRequestProducers(localMediaId: string): LocalMediaSfuProducer[]
  closeDataProducer(producerId: string): void
  /**
   * Refuse SFU use when the file provider is on another replica.
   * @throws Error with message `sfu_wrong_node` when affinity mismatches.
   */
  assertProviderNodeAffinity(providerNodeId: string | undefined): void
}

export function createLocalMediaSfuPort(): LocalMediaSfuPort {
  return {
    async ensureRuntime() {
      return Boolean(await ensureMediasoupRuntime())
    },
    createRouter: mediasoupCreateRouter,
    createTransport: mediasoupCreateTransport,
    connectTransport: mediasoupConnectTransport,
    produceData: mediasoupProduceData,
    consumeData: mediasoupConsumeData,
    closeTransport: mediasoupCloseTransport,
    onTransportClosed: onMediasoupTransportClosed,
    getTransportAppData: getMediasoupTransportAppData,
    getDataProducerAppData: getMediasoupDataProducerAppData,
    getProviderProducer: getLocalMediaSfuProducer,
    listProviderProducers: listLocalMediaSfuProducers,
    listRequestProducers: listLocalMediaSfuRequestProducers,
    closeDataProducer: closeLocalMediaSfuDataProducer,
    assertProviderNodeAffinity(providerNodeId) {
      // Sticky WS alone is insufficient: UDP MEDIASOUP_RTC_UDP_PORT must also
      // reach this process. Wrong-node signaling is an affinity failure.
      void MEDIASOUP_RTC_UDP_PORT
      if (
        typeof providerNodeId === "string" &&
        providerNodeId.length > 0 &&
        providerNodeId !== getAppNodeId()
      ) {
        throw new Error("sfu_wrong_node")
      }
    },
  }
}

/** Re-export worker-died hook for handlers that broadcast unavailable. */
export { onMediasoupWorkerDied }
