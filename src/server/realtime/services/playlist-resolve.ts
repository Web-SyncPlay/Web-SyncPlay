import {
  resolveMediaSource,
  type ResolvedMedia,
} from "@/server/media/resolve"
import type { RoomStateStorePort } from "@/server/realtime/ports"
import type { PlaylistItem } from "@/zod/types"

/** Process-local dedupe so multi-kick of the same item does not pile up yt-dlp work. */
const inflightPlaylistResolves = new Set<string>()

function resolveKey(roomId: string, itemId: string) {
  return `${roomId}:${itemId}`
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
  // Clear deprecated room-selection aliases
  item.selectedStreamId = undefined
  item.selectedTextTrackId = undefined
  item.durationSeconds = resolved.durationSeconds ?? undefined
  item.isLive = resolved.isLive ?? undefined
  item.ingestStatus = "ready"
  item.ingestError = undefined

  const preferred = options?.preferredTitle?.trim()
  if (preferred && item.name.trim() === preferred) {
    item.name = resolved.title || preferred
  } else if (item.name.trim() === item.sourceUrl.trim()) {
    item.name = resolved.title || item.sourceUrl
  }
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
      state.updatedAt = Date.now()
      return state
    })
    if (written) return true
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
          item.ingestError =
            resolved.resolveUserMessage ?? failureMessage
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
