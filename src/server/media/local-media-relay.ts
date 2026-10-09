/**
 * Public local-media relay API.
 *
 * Implementation lives under `./local-media-relay/`:
 * - `types.ts` — constants, request/chunk types, LocalMediaRelayError
 * - `pending.ts` — in-flight request map + resolveLocalMediaChunk
 * - `chunk.ts` — payload encode/decode + Redis reply push
 * - `sockets.ts` — provider WebSocket read fan-out
 * - `providers.ts` — local WS / internal HTTP / Redis fetch paths
 * - `subscriber.ts` — cluster pub/sub request handler
 * - `fetch.ts` — range orchestration, aligned blocks, byte stream
 */

export type {
  LocalMediaChunkPayload,
  LocalMediaReadRequest,
} from "@/server/media/local-media-relay/types"

export {
  LOCAL_MEDIA_RELAY_CHUNK_BYTES,
  LocalMediaRelayError,
} from "@/server/media/local-media-relay/types"

export { resolveLocalMediaChunk } from "@/server/media/local-media-relay/pending"

export { ensureRelaySubscriber } from "@/server/media/local-media-relay/subscriber"

export {
  alignedBlockStart,
  createLocalMediaByteStream,
  fetchLocalMediaAlignedBlock,
  fetchLocalMediaRangeBytes,
} from "@/server/media/local-media-relay/fetch"

export { invalidateLocalMediaBlockCache } from "@/server/media/local-media-block-cache"
