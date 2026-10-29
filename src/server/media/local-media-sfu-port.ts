import type { types as MsTypes } from "mediasoup"

import {
  closeLocalMediaSfuDataProducer,
  ensureMediasoupRuntime,
  getLocalMediaSfuProducer,
  getMediasoupDataProducerAppData,
  getMediasoupTransportAppData,
  listLocalMediaSfuProducers,
  listLocalMediaSfuRequestProducers,
  type LocalMediaSfuProducer,
  mediasoupCloseRoom,
  mediasoupCloseTransport,
  mediasoupConnectTransport,
  mediasoupConsumeData,
  mediasoupCreateRouter,
  mediasoupCreateTransport,
  type MediasoupDataProducerAppData,
  mediasoupProduceData,
  type MediasoupTransportAppData,
  onMediasoupTransportClosed,
  onMediasoupWorkerDied,
} from "@/server/media/mediasoup-runtime"
import { getAppNodeId } from "@/server/node-id"

/**
 * Process-local mediasoup SFU for local-media DataChannels.
 * Wrong `providerNodeId` → `sfu_wrong_node` (do not create undeliverable transports).
 * Affinity ops: README multi-replica SFU notes.
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
  consumeData(input: { transportId: string; dataProducerId: string }): Promise<{
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
  listProviderProducers(): Array<
    LocalMediaSfuProducer & { localMediaId: string }
  >
  listRequestProducers(localMediaId: string): LocalMediaSfuProducer[]
  closeDataProducer(producerId: string): void
  /** Drop process-local SFU state for a destroyed room. */
  closeRoom(roomId: string): void
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
    closeRoom: mediasoupCloseRoom,
    assertProviderNodeAffinity(providerNodeId) {
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

export { onMediasoupWorkerDied }
