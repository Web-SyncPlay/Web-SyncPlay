import type { RoomState } from "@/zod/types"
import { getAbrVariantMeta } from "@/lib/local-media-abr"

/** Extract local media UUID from `/api/media/local/{id}` (optional /hls suffix ignored). */
export function localMediaIdFromSrc(src: string | undefined): string | null {
  if (!src) return null
  const match = /\/api\/media\/local\/([^/?#]+)/i.exec(src)
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

export function findLocalPlaylistItemForMediaId(
  roomState: RoomState | null | undefined,
  localMediaId: string,
) {
  if (!roomState) return null
  for (const item of roomState.playlist) {
    if (item.sourceKind !== "local_file") continue
    if (item.localMediaId === localMediaId) return item
    const streams = item.mediaStreams ?? []
    for (const stream of streams) {
      const id = localMediaIdFromSrc(stream.src)
      if (id === localMediaId) return item
      // HLS master /api/media/local/{parent}/hls — parent id is first segment
      if (stream.src.includes(`/api/media/local/${encodeURIComponent(localMediaId)}/`)) {
        return item
      }
    }
  }
  return null
}

export function resolveLocalMediaProviderUserId(
  roomState: RoomState | null | undefined,
  localMediaId: string,
): string | null {
  const item = findLocalPlaylistItemForMediaId(roomState, localMediaId)
  return item?.localOriginUserId ?? null
}

export function resolveLocalMediaMeta(
  roomState: RoomState | null | undefined,
  localMediaId: string,
): { mimeType: string; sizeBytes: number } | null {
  const remembered = getAbrVariantMeta(localMediaId)
  if (remembered) {
    return { mimeType: remembered.mimeType, sizeBytes: remembered.sizeBytes }
  }

  const item = findLocalPlaylistItemForMediaId(roomState, localMediaId)
  if (!item) return null

  if (item.localMediaId === localMediaId) {
    const mimeType =
      item.localMimeType ??
      item.mediaStreams?.find((s) => s.type && !s.type.includes("mpegurl"))?.type
    if (!mimeType || !item.localSizeBytes) return null
    return { mimeType, sizeBytes: item.localSizeBytes }
  }

  const stream = (item.mediaStreams ?? []).find(
    (s) => localMediaIdFromSrc(s.src) === localMediaId,
  )
  if (stream?.type && stream.bitrate && stream.bitrate > 0 && item.durationSeconds) {
    // Approximate size from bitrate × duration when child size unknown.
    const sizeBytes = Math.max(
      1,
      Math.round((stream.bitrate * item.durationSeconds) / 8),
    )
    return { mimeType: stream.type, sizeBytes }
  }
  if (stream?.type && item.localSizeBytes) {
    return { mimeType: stream.type, sizeBytes: item.localSizeBytes }
  }
  return null
}
