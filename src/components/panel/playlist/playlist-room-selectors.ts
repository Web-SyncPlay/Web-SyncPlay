import type {
  ClientRoomState,
  LoopMode,
  PlaylistItem,
  RoomRole,
} from "@/contracts/types"
import { resolveCurrentPlaylistItemId } from "@/shared/playlist-current"

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
  /** userId → display name for local-file origin users in the playlist. */
  localOriginUsernames: Record<string, string>
}

function localOriginUsernamesEqual(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false
  }
  return true
}

/** Content-stable map of local-file origin userIds → usernames. */
export function selectLocalOriginUsernames(
  roomState: ClientRoomState,
): Record<string, string> {
  const names: Record<string, string> = {}
  for (const item of roomState.playlist) {
    if (item.sourceKind !== "local_file") continue
    const originId = item.localOriginUserId ?? item.createdBy
    if (!originId || originId in names) continue
    names[originId] =
      roomState.participants[originId]?.username?.trim() || originId
  }
  return names
}

export function selectPlaylistShellSlice(
  roomState: ClientRoomState,
  userId: string,
): PlaylistShellSlice {
  return {
    playlist: roomState.playlist,
    currentItemId: resolveCurrentPlaylistItemId(roomState),
    playlistLoop: roomState.playback.playlistLoop,
    myRole: roomState.participants[userId]?.role,
    localOriginUsernames: selectLocalOriginUsernames(roomState),
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
    a.myRole === b.myRole &&
    localOriginUsernamesEqual(a.localOriginUsernames, b.localOriginUsernames)
  )
}