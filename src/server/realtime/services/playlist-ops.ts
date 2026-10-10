import { resetPlaybackTimeline } from "@/server/realtime/services/timeline"
import type { PlaylistItem, RoomState } from "@/contracts/types"

/** True when a remote URL item may be explicitly re-resolved. */
export function canRetryRemotePlaylistItem(
  item: PlaylistItem | undefined,
): item is PlaylistItem {
  if (!item) return false
  if (item.blockedReason === "local_owner_offline") return false
  return item.sourceKind === "remote_url"
}

/**
 * Switch the active playlist index and reset the timeline.
 * Preserves play/pause intent (callers must not force pause).
 */
export function applyPlaylistSelect(state: RoomState, index: number): boolean {
  if (index < 0 || index >= state.playlist.length) return false
  state.currentIndex = index
  resetPlaybackTimeline(state)
  return true
}

/**
 * Move one playlist entry. Keeps `currentIndex` pointed at the same media id.
 * Returns the moved entry, or null when indices are out of range.
 */
export function applyPlaylistReorder(
  state: RoomState,
  from: number,
  to: number,
): PlaylistItem | null {
  if (
    from < 0 ||
    to < 0 ||
    from >= state.playlist.length ||
    to >= state.playlist.length
  ) {
    return null
  }
  const currentMediaId = state.playlist[state.currentIndex]?.id
  const [entry] = state.playlist.splice(from, 1)
  if (!entry) return null
  state.playlist.splice(to, 0, entry)
  if (currentMediaId) {
    const nextCurrentIndex = state.playlist.findIndex(
      (item) => item.id === currentMediaId,
    )
    if (nextCurrentIndex >= 0) state.currentIndex = nextCurrentIndex
  }
  return entry
}

export function applyPlaylistRename(
  state: RoomState,
  itemId: string,
  rawName: string,
): { item: PlaylistItem; previousName: string; nextName: string } | null {
  const item = state.playlist.find((entry) => entry.id === itemId)
  if (!item) return null
  const nextName = rawName.trim()
  if (!nextName || nextName === item.name) return null
  const previousName = item.name
  item.name = nextName
  return { item, previousName, nextName }
}

/**
 * Drop a removed playlist item id from every participant's viewer preferences.
 */
export function pruneViewerMediaItemId(
  state: RoomState,
  itemId: string,
): void {
  for (const participant of Object.values(state.participants)) {
    const byItemId = participant.viewerMedia?.byItemId
    if (!byItemId || !(itemId in byItemId)) continue
    delete byItemId[itemId]
    if (Object.keys(byItemId).length === 0) {
      delete participant.viewerMedia
    }
  }
}

/**
 * Remove a playlist item and adjust `currentIndex` / timeline for empty or
 * current-item removal. Also prunes `viewerMedia.byItemId` for the removed id.
 */
export function applyPlaylistRemove(
  state: RoomState,
  itemId: string,
): { removed: PlaylistItem; index: number } | null {
  const index = state.playlist.findIndex((entry) => entry.id === itemId)
  if (index < 0) return null
  const [removed] = state.playlist.splice(index, 1)
  if (!removed) return null

  if (state.playlist.length === 0) {
    state.currentIndex = 0
    resetPlaybackTimeline(state, Date.now(), { pause: true })
  } else if (index < state.currentIndex) {
    state.currentIndex -= 1
  } else if (index === state.currentIndex) {
    state.currentIndex = Math.min(index, state.playlist.length - 1)
    resetPlaybackTimeline(state)
  }

  pruneViewerMediaItemId(state, removed.id)
  return { removed, index }
}

/**
 * Client-reported ingest error / clear. When reporting an error on the current
 * item and more remain, advances to the next index and pauses.
 */
export function applyPlaylistItemError(
  state: RoomState,
  itemId: string,
  error: string | null,
): { item: PlaylistItem; cleared: boolean } | null {
  const index = state.playlist.findIndex((entry) => entry.id === itemId)
  if (index < 0) return null
  const item = state.playlist[index]
  if (!item) return null

  if (error === null) {
    if (item.ingestStatus !== "error" && !item.ingestError) {
      return null
    }
    item.ingestStatus = "ready"
    item.ingestError = undefined
    return { item, cleared: true }
  }

  item.ingestStatus = "error"
  item.ingestError = error

  if (state.currentIndex === index && state.playlist.length > 1) {
    const nextIndex = Math.min(state.playlist.length - 1, index + 1)
    if (nextIndex !== index) {
      state.currentIndex = nextIndex
      resetPlaybackTimeline(state, Date.now(), { pause: true })
    }
  }

  return { item, cleared: false }
}

/**
 * Fill catalog duration from a player observation when missing.
 * First finite positive value wins — avoids thrash between peers.
 */
export function applyPlaylistItemDuration(
  state: RoomState,
  itemId: string,
  durationSeconds: number,
): PlaylistItem | null {
  const item = state.playlist.find((entry) => entry.id === itemId)
  if (!item || item.isLive === true) return null
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null

  const next = Math.round(durationSeconds)
  const existing = Number(item.durationSeconds)
  if (Number.isFinite(existing) && existing > 0) {
    return null
  }

  item.durationSeconds = next
  return item
}

export function isPlaylistAtLimit(state: RoomState, limit: number): boolean {
  return state.playlist.length >= limit
}

export function buildRemoteUrlPlaylistItem(params: {
  id: string
  sourceUrl: string
  createdBy: string
  createdAt?: number
}): PlaylistItem {
  const { id, sourceUrl, createdBy, createdAt = Date.now() } = params
  return {
    id,
    name: sourceUrl,
    sourceKind: "remote_url",
    playbackMode: "direct",
    sourceUrl,
    playableUrl: sourceUrl,
    ingestStatus: "resolving",
    createdBy,
    createdAt,
  }
}

export function buildLocalFilePlaylistItem(params: {
  id: string
  name: string
  localMediaId: string
  mimeType: string
  sizeBytes: number
  createdBy: string
  createdAt?: number
  durationSeconds?: number
}): PlaylistItem {
  const {
    id,
    name,
    localMediaId,
    mimeType,
    sizeBytes,
    createdBy,
    createdAt = Date.now(),
    durationSeconds,
  } = params
  const playableUrl = `/api/media/local/${encodeURIComponent(localMediaId)}`
  const durationOk =
    typeof durationSeconds === "number" &&
    Number.isFinite(durationSeconds) &&
    durationSeconds > 0
  return {
    id,
    name,
    sourceKind: "local_file",
    playbackMode: "direct",
    sourceUrl: playableUrl,
    playableUrl,
    ingestStatus: "ready",
    ...(durationOk
      ? { durationSeconds: Math.round(durationSeconds) }
      : {}),
    mediaStreams: [
      {
        id: "local-default",
        src: playableUrl,
        type: mimeType,
        isDefault: true,
        label: "Local",
        kind: "combined",
      },
    ],
    defaultStreamId: "local-default",
    localMediaId,
    localOriginUserId: createdBy,
    localMimeType: mimeType,
    localSizeBytes: sizeBytes,
    createdBy,
    createdAt,
  }
}
