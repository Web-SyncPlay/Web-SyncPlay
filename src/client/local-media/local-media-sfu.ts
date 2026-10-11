/**
 * mediasoup DataChannel SFU for local-media blocks.
 * DataProducers/Consumers are one-way, so each media id uses two channels:
 * provider blocks → viewers, and viewer requests → provider.
 * Wire protocol matches P2P (`lm-block-req` / `lm-block-meta`); binary frames
 * are prefixed with a 36-char request id so other viewers' responses can be skipped.
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
