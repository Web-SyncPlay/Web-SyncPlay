import { getOrFetchLocalMediaBlock } from "@/server/media/local-media-block-cache"
import {
  fetchChunkViaInternalHttp,
  fetchChunkViaLocalSockets,
  fetchChunkViaRedis,
} from "@/server/media/local-media-relay/providers"
import {
  LOCAL_MEDIA_RELAY_CHUNK_BYTES,
  LocalMediaRelayError,
} from "@/server/media/local-media-relay/types"
import type { LocalMediaEntry } from "@/server/media/local-media-store"

/**
 * Fetch bytes from the providing browser (no cache). Prefer
 * {@link fetchLocalMediaAlignedBlock} for shared viewer traffic.
 *
 * Order: local WS → internal HTTP to provider node → Redis pub/sub flood.
 */
export async function fetchLocalMediaRangeBytes(
  entry: LocalMediaEntry,
  start: number,
  end: number,
): Promise<Uint8Array> {
  if (start < 0 || end < start || start >= entry.sizeBytes) {
    throw new LocalMediaRelayError("invalid_range")
  }
  const clampedEnd = Math.min(end, entry.sizeBytes - 1)
  try {
    const local = await fetchChunkViaLocalSockets(entry, start, clampedEnd)
    if (local) {
      return local
    }
    const remote = await fetchChunkViaInternalHttp(entry, start, clampedEnd)
    if (remote) {
      return remote
    }
    return await fetchChunkViaRedis(entry, start, clampedEnd)
  } catch (error) {
    if (error instanceof LocalMediaRelayError) throw error
    console.error("[local-media-relay] provider fetch failed", {
      mediaId: entry.id,
      roomId: entry.roomId,
      ownerUserId: entry.ownerUserId,
      start,
      end: clampedEnd,
      error,
    })
    throw new LocalMediaRelayError(
      "relay_failed",
      error instanceof Error ? error.message : undefined,
    )
  }
}

/** Inclusive aligned block start for a byte offset. */
export function alignedBlockStart(offset: number, chunkBytes: number) {
  return Math.floor(offset / chunkBytes) * chunkBytes
}

/**
 * One cacheable provider block. Concurrent viewers coalesce via singleflight;
 * later viewers hit the process-local LRU so the sharer’s upload is ~1× per block.
 */
export async function fetchLocalMediaAlignedBlock(
  entry: LocalMediaEntry,
  blockStart: number,
): Promise<{ bytes: Uint8Array; cacheHit: boolean }> {
  const chunkBytes = LOCAL_MEDIA_RELAY_CHUNK_BYTES
  const aligned = alignedBlockStart(blockStart, chunkBytes)
  if (aligned !== blockStart) {
    throw new LocalMediaRelayError(
      "invalid_range",
      `blockStart must be aligned to ${chunkBytes}`,
    )
  }
  const blockEnd = Math.min(aligned + chunkBytes - 1, entry.sizeBytes - 1)

  return await getOrFetchLocalMediaBlock({
    mediaId: entry.id,
    blockStart: aligned,
    fetch: () => fetchLocalMediaRangeBytes(entry, aligned, blockEnd),
  })
}

/**
 * Stream an inclusive byte range using aligned cached blocks so overlapping
 * viewer Ranges share provider uploads.
 */
export function createLocalMediaByteStream(
  entry: LocalMediaEntry,
  start: number,
  end: number,
): ReadableStream<Uint8Array> {
  const chunkBytes = LOCAL_MEDIA_RELAY_CHUNK_BYTES
  let offset = start
  const last = Math.min(end, entry.sizeBytes - 1)

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (offset > last) {
        controller.close()
        return
      }
      const blockStart = alignedBlockStart(offset, chunkBytes)
      try {
        const { bytes, cacheHit } = await fetchLocalMediaAlignedBlock(
          entry,
          blockStart,
        )
        const blockEnd = blockStart + bytes.byteLength - 1
        const sliceFrom = offset - blockStart
        const sliceTo = Math.min(last, blockEnd) - blockStart + 1
        const slice = bytes.subarray(sliceFrom, sliceTo)
        offset = blockStart + sliceTo
        if (!cacheHit) {
          console.info("[local-media-relay] block fetched from provider", {
            mediaId: entry.id,
            blockStart,
            bytes: bytes.byteLength,
          })
        }
        controller.enqueue(slice)
      } catch (error) {
        controller.error(error)
      }
    },
    cancel() {
      offset = last + 1
    },
  })
}
