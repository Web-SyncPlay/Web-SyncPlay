/**
 * In-process mediasoup DataChannel SFU (bundled in the app image).
 * Re-exports the runtime API used by signaling handlers.
 */
export {
  clearLocalMediaSfuProducer,
  ensureMediasoupRuntime,
  getLocalMediaSfuProducer,
  getMediasoupDataProducerAppData,
  getMediasoupTransportAppData,
  isMediasoupSfuConfigured,
  listLocalMediaSfuProducers,
  listLocalMediaSfuRequestProducers,
  mediasoupCloseTransport,
  mediasoupConnectTransport,
  mediasoupConsumeData,
  mediasoupCreateRouter,
  mediasoupCreateTransport,
  mediasoupProduceData,
  onMediasoupTransportClosed,
  type LocalMediaSfuProducer,
  type MediasoupDataProducerAppData,
  type MediasoupTransportAppData,
} from "@/server/media/mediasoup-runtime"
