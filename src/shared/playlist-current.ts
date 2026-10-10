import type { PlaylistItem, RoomState } from "@/contracts/types"

/**
 * Resolve the active playlist item by stable `playback.mediaId` first, then
 * fall back to `currentIndex`. Prefer this over raw index lookup so control
 * patches that arrive before a playlist snapshot do not briefly select a
 * neighbor.
 */
export function resolveCurrentPlaylistItem(
  roomState: Pick<RoomState, "playlist" | "currentIndex" | "playback">,
): PlaylistItem | undefined {
  const mediaId = roomState.playback.mediaId
  if (mediaId) {
    const byId = roomState.playlist.find((item) => item.id === mediaId)
    if (byId) return byId
  }
  return roomState.playlist[roomState.currentIndex]
}

/** Stable id of the active playlist item, if any. */
export function resolveCurrentPlaylistItemId(
  roomState: Pick<RoomState, "playlist" | "currentIndex" | "playback">,
): string | undefined {
  return resolveCurrentPlaylistItem(roomState)?.id
}
