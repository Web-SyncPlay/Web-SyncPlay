import { resolveCurrentPlaylistItemId } from "@/shared/playlist-current"
import type {
  LoopMode,
  PlaylistItem,
  RoomRole,
  RoomState,
} from "@/contracts/types"

/**
 * Narrow playlist-panel inputs derived from roomState. Presence-only batches
 * keep playlist identity; role/loop/current id only flip when those fields
 * actually change.
 */
export type PlaylistShellSlice = {
  playlist: PlaylistItem[]
  currentItemId: string | undefined
  playlistLoop: LoopMode
  myRole: RoomRole | undefined
}

export function selectPlaylistShellSlice(
  roomState: RoomState,
  userId: string,
): PlaylistShellSlice {
  return {
    playlist: roomState.playlist,
    currentItemId: resolveCurrentPlaylistItemId(roomState),
    playlistLoop: roomState.playback.playlistLoop,
    myRole: roomState.participants[userId]?.role,
  }
}

/** True when two playlist shell slices are equal for memo isolation. */
export function playlistShellSlicesEqual(
  a: PlaylistShellSlice,
  b: PlaylistShellSlice,
): boolean {
  return (
    a.playlist === b.playlist &&
    a.currentItemId === b.currentItemId &&
    a.playlistLoop === b.playlistLoop &&
    a.myRole === b.myRole
  )
}
