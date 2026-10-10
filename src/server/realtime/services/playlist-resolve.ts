import { invalidateYtDlpExtractCache } from "@/server/media/yt-dlp"
import { beginResolveLease } from "@/server/media/yt-dlp/resolve-lease"
import {
  resolveMediaSource,
  type ResolvedMedia,
} from "@/server/media/resolve"
import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import type { RoomStateStorePort } from "@/server/realtime/ports"
import { bumpRoomRevisions } from "@/server/realtime/services/timeline"
import { sanitizeMediaTitle } from "@/shared/sanitize-display"
import type { PlaylistItem, RoomState } from "@/contracts/types"

/** Process-local dedupe so multi-kick of the same item does not pile up yt-dlp work. */
const inflightPlaylistResolves = new Set<string>()

function resolveKey(roomId: string, itemId: string) {
  return `${roomId}:${itemId}`
}

function touchRoomStructural(state: RoomState) {
  state.updatedAt = Date.now()
  bumpRoomRevisions(state)
}

function publishRoomSnapshot(store: RoomStateStorePort, roomId: string) {
  const bus = getRoomBroadcastBus()
  bus.attachStore(store)
  bus.markSnapshotDirty(roomId)
}

function resolveDisplayName(
  item: PlaylistItem,
  resolved: ResolvedMedia,
  preferredTitle?: string,
): string {
  const preferred = preferredTitle?.trim()
  const safeTitle =
    (resolved.title ? sanitizeMediaTitle(resolved.title) : null) ?? null
  if (preferred && item.name.trim() === preferred) {
    return safeTitle || sanitizeMediaTitle(preferred) || preferred
  }
  if (item.name.trim() === item.sourceUrl.trim()) {
    return safeTitle || sanitizeMediaTitle(item.sourceUrl) || item.sourceUrl
  }
  return item.name
}

export function applyResolvedMediaToItem(
  item: PlaylistItem,
  resolved: ResolvedMedia,
  options?: { preferredTitle?: string },
) {
  item.playableUrl = resolved.playableUrl
  item.playbackMode = resolved.playbackMode
  item.mediaStreams = resolved.mediaStreams
  item.defaultStreamId = resolved.defaultStreamId
  item.textTracks = resolved.textTracks
  item.defaultTextTrackId = resolved.defaultTextTrackId
  item.durationSeconds = resolved.durationSeconds ?? undefined
  item.isLive = resolved.isLive ?? undefined
  item.ingestStatus = "ready"
  item.ingestError = undefined
  item.name = resolveDisplayName(item, resolved, options?.preferredTitle)
}

async function commitResolvingItem(
  store: RoomStateStorePort,
  roomId: string,
  itemId: string,
  mutateItem: (item: PlaylistItem) => void,
  options?: { retryUntilPresent?: boolean },
): Promise<boolean> {
  const maxAttempts = options?.retryUntilPresent ? 24 : 1
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const written = await store.updateRoom(roomId, async (state) => {
      if (!state) return null
      const item = state.playlist.find((entry) => entry.id === itemId)
      // Only settle items still waiting — drop races with rename/remove/retry.
      if (!item || item.ingestStatus !== "resolving") {
        return options?.retryUntilPresent ? state : null
      }
      mutateItem(item)
      touchRoomStructural(state)
      return state
    })
    if (written) {
      publishRoomSnapshot(store, roomId)
      return true
    }
    if (!options?.retryUntilPresent) return false
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(25 * 2 ** Math.min(attempt, 4), 200)),
    )
  }
  return false
}

/**
 * Resolve a remote playlist item that is already persisted as `resolving`.
 * Safe to call after the room write that enqueued the item.
 */
export async function resolvePlaylistItem(params: {
  store: RoomStateStorePort
  roomId: string
  itemId: string
  sourceUrl: string
  title?: string
  /** Retry briefly when the room/item may not be visible yet (seed after join). */
  retryUntilPresent?: boolean
  failureMessage?: string
}): Promise<void> {
  const {
    store,
    roomId,
    itemId,
    sourceUrl,
    title,
    retryUntilPresent = false,
    failureMessage = "Failed to resolve metadata",
  } = params
  const key = resolveKey(roomId, itemId)
  if (inflightPlaylistResolves.has(key)) return
  inflightPlaylistResolves.add(key)

  const lease = await beginResolveLease({
    roomId,
    itemId,
    sourceUrl,
    title,
  })

  try {
    const resolved = await resolveMediaSource({
      url: sourceUrl,
      name: title,
      roomId,
      mediaId: itemId,
    })

    if (resolved.failureReason) {
      await commitResolvingItem(
        store,
        roomId,
        itemId,
        (item) => {
          item.ingestStatus = "error"
          item.ingestError = resolved.resolveUserMessage ?? failureMessage
        },
        { retryUntilPresent },
      )
      return
    }

    await commitResolvingItem(
      store,
      roomId,
      itemId,
      (item) => {
        applyResolvedMediaToItem(item, resolved, { preferredTitle: title })
      },
      { retryUntilPresent },
    )
  } catch {
    await commitResolvingItem(
      store,
      roomId,
      itemId,
      (item) => {
        item.ingestStatus = "error"
        item.ingestError = failureMessage
      },
      { retryUntilPresent },
    )
  } finally {
    lease?.stop()
    inflightPlaylistResolves.delete(key)
  }
}

/** Kick background resolve for every remote item still marked `resolving`. */
export function scheduleResolvingPlaylistItems(
  store: RoomStateStorePort,
  roomId: string,
  playlist: PlaylistItem[],
) {
  for (const item of playlist) {
    if (item.ingestStatus !== "resolving") continue
    if (item.sourceKind === "local_file") continue
    void resolvePlaylistItem({
      store,
      roomId,
      itemId: item.id,
      sourceUrl: item.sourceUrl,
      title: item.name,
      retryUntilPresent: true,
      failureMessage: "Failed to resolve default media",
    })
  }
}

/**
 * Invalidate extract cache and re-run resolve for a remote playlist item.
 * Used by explicit retry and by proxy 401/403 stale-upstream recovery.
 */
export async function reresolveRemotePlaylistItem(params: {
  store: RoomStateStorePort
  roomId: string
  itemId: string
}): Promise<boolean> {
  const { store, roomId, itemId } = params
  let sourceUrl: string | undefined
  let title: string | undefined

  const written = await store.updateRoom(roomId, async (state) => {
    if (!state) return null
    const item = state.playlist.find((entry) => entry.id === itemId)
    if (!item || item.sourceKind !== "remote_url") return null
    if (item.blockedReason === "local_owner_offline") return null
    sourceUrl = item.sourceUrl
    title = item.name
    if (item.ingestStatus === "resolving") {
      // Already in flight — still invalidate cache so the next pass is fresh.
      return null
    }
    item.ingestStatus = "resolving"
    item.ingestError = undefined
    touchRoomStructural(state)
    return state
  })

  if (!sourceUrl) return false

  await invalidateYtDlpExtractCache(sourceUrl)

  if (written) {
    publishRoomSnapshot(store, roomId)
  }

  await resolvePlaylistItem({
    store,
    roomId,
    itemId,
    sourceUrl,
    title,
  })
  return true
}
