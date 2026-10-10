import { resolveCurrentPlaylistItem } from "@/shared/playlist-current"
import type {
  ClientRoomState,
  PlaybackState,
  PlaylistItem,
  RoomRole,
  ViewerMediaItemPreference,
} from "@/contracts/types"

/** Playback slice — referentially stable across presence-only merges. */
export function selectPlayback(roomState: ClientRoomState): PlaybackState {
  return roomState.playback
}

export function selectCurrentItem(
  roomState: Pick<ClientRoomState, "playlist" | "currentIndex" | "playback">,
): PlaylistItem | undefined {
  return resolveCurrentPlaylistItem(roomState)
}

export function selectSeekPreview(
  roomState: ClientRoomState,
): PlaybackState["seekPreview"] {
  return roomState.playback.seekPreview
}

export function selectParticipantRole(
  roomState: ClientRoomState,
  userId: string,
): RoomRole {
  return roomState.participants[userId]?.role ?? "guest"
}

/**
 * Local-file owner online flag. Boolean so presence churn on other users does
 * not invalidate owner-offline effects.
 */
export function selectOwnerConnected(
  roomState: ClientRoomState,
  current: PlaylistItem | undefined,
): boolean {
  if (!current || current.sourceKind !== "local_file") {
    return true
  }
  const ownerId = current.localOriginUserId
  if (!ownerId) {
    return true
  }
  return roomState.participants[ownerId]?.connected ?? false
}

/** Display name for the active remote seeker; defaults when unknown. */
export function selectRemoteSeekerName(
  roomState: ClientRoomState,
  seekPreview: PlaybackState["seekPreview"],
): string {
  const seekerId = seekPreview?.userId
  if (!seekerId) {
    return "Another user"
  }
  return roomState.participants[seekerId]?.username ?? "Another user"
}

export function selectViewerItemPrefs(
  roomState: ClientRoomState,
  userId: string,
  itemId: string | undefined,
): ViewerMediaItemPreference | undefined {
  if (!itemId) {
    return undefined
  }
  return roomState.participants[userId]?.viewerMedia?.byItemId[itemId]
}

/**
 * Narrow shell inputs derived from roomState. Presence-only batches keep
 * playback/playlist identity; booleans/strings only flip when that field
 * actually changes (owner connect, role, seeker name).
 */
export type PlayerShellSlice = {
  playback: PlaybackState
  currentItem: PlaylistItem | undefined
  currentIndex: number
  playlist: PlaylistItem[]
  seekPreview: PlaybackState["seekPreview"]
  ownerConnected: boolean
  myRole: RoomRole
  remoteSeekerName: string
  viewerPrefs: ViewerMediaItemPreference | undefined
}

export function selectPlayerShellSlice(
  roomState: ClientRoomState,
  userId: string,
): PlayerShellSlice {
  const currentItem = selectCurrentItem(roomState)
  const seekPreview = selectSeekPreview(roomState)
  return {
    playback: selectPlayback(roomState),
    currentItem,
    currentIndex: roomState.currentIndex,
    playlist: roomState.playlist,
    seekPreview,
    ownerConnected: selectOwnerConnected(roomState, currentItem),
    myRole: selectParticipantRole(roomState, userId),
    remoteSeekerName: selectRemoteSeekerName(roomState, seekPreview),
    viewerPrefs: selectViewerItemPrefs(roomState, userId, currentItem?.id),
  }
}

/** True when two shell slices are shallow-equal for memo isolation. */
export function playerShellSlicesEqual(
  a: PlayerShellSlice,
  b: PlayerShellSlice,
): boolean {
  return (
    a.playback === b.playback &&
    a.currentItem === b.currentItem &&
    a.currentIndex === b.currentIndex &&
    a.playlist === b.playlist &&
    a.seekPreview === b.seekPreview &&
    a.ownerConnected === b.ownerConnected &&
    a.myRole === b.myRole &&
    a.remoteSeekerName === b.remoteSeekerName &&
    a.viewerPrefs === b.viewerPrefs
  )
}
