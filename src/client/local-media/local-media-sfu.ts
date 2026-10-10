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
 *
 * Implementation is split across:
 *  - local-media-sfu-session.ts (device / transports / singleton)
 *  - local-media-sfu-provider.ts
 *  - local-media-sfu-viewer.ts
 */

export type {
  SfuRequestType,
  SfuResult,
  SfuSendRequest,
} from "./local-media-sfu-session"

export {
  closeLocalMediaSfu,
  configureLocalMediaSfu,
} from "./local-media-sfu-session"

export {
  ensureLocalMediaSfuProvider,
  ensureLocalMediaSfuRequestConsumer,
} from "./local-media-sfu-provider"

export {
  ensureLocalMediaSfuViewer,
  fetchLocalMediaRangeViaSfu,
  isLocalMediaSfuViewerReady,
  warmLocalMediaSfuViewer,
} from "./local-media-sfu-viewer"
