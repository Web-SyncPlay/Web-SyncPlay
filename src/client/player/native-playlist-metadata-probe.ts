import type { PlaylistItem } from "@/contracts/types"
import { isNativeProviderUrl } from "@/shared/player-utils"

/** Session-local: item ids already probed (or in flight) in this tab. */
const probedItemIds = new Set<string>()

/** URLs the local user just added; matched to playlist items by sourceUrl. */
const pendingSourceUrls: string[] = []

const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) {
    listener()
  }
}

export function isPlaylistItemNamePlaceholder(
  item: Pick<PlaylistItem, "name" | "sourceUrl">,
): boolean {
  return item.name.trim() === item.sourceUrl.trim()
}

export function playlistItemNeedsNativeMetadata(
  item: Pick<PlaylistItem, "sourceUrl" | "name" | "durationSeconds" | "isLive">,
): { needsTitle: boolean; needsDuration: boolean } {
  if (!isNativeProviderUrl(item.sourceUrl)) {
    return { needsTitle: false, needsDuration: false }
  }
  const needsTitle = isPlaylistItemNamePlaceholder(item)
  const catalogSec = Number(item.durationSeconds)
  const needsDuration =
    item.isLive !== true && !(Number.isFinite(catalogSec) && catalogSec > 0)
  return { needsTitle, needsDuration }
}

/** Queue a native URL for metadata probing after the local user adds it. */
export function queueNativePlaylistMetadataProbe(sourceUrl: string): boolean {
  const trimmed = sourceUrl.trim()
  if (!trimmed || !isNativeProviderUrl(trimmed)) return false
  pendingSourceUrls.push(trimmed)
  emit()
  return true
}

export function subscribeNativePlaylistMetadataProbeQueue(
  listener: () => void,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function hasPendingNativePlaylistMetadataProbes(): boolean {
  return pendingSourceUrls.length > 0
}

export function wasNativePlaylistItemProbed(itemId: string): boolean {
  return probedItemIds.has(itemId)
}

/** Mark probed so the same item is never spun up twice in this tab. */
export function markNativePlaylistItemProbed(itemId: string): void {
  probedItemIds.add(itemId)
}

/**
 * Release an in-flight probe (e.g. React Strict Mode remount) so it can be
 * claimed again. Completed probes stay marked to prevent repeats.
 */
export function releaseNativePlaylistMetadataProbe(params: {
  itemId: string
  sourceUrl: string
  completed: boolean
}): void {
  const { itemId, sourceUrl, completed } = params
  if (completed) {
    probedItemIds.add(itemId)
    return
  }
  probedItemIds.delete(itemId)
  const trimmed = sourceUrl.trim()
  if (trimmed && !pendingSourceUrls.includes(trimmed)) {
    pendingSourceUrls.unshift(trimmed)
  }
  emit()
}

/**
 * Match the oldest pending add URL to a playlist item created by this user.
 * Consumes the pending URL and marks the item probed when a match is found.
 */
export function claimNextNativePlaylistMetadataProbe(params: {
  playlist: readonly PlaylistItem[]
  userId: string
}): {
  item: PlaylistItem
  needsTitle: boolean
  needsDuration: boolean
} | null {
  const { playlist, userId } = params
  while (pendingSourceUrls.length > 0) {
    const sourceUrl = pendingSourceUrls[0]!
    const matches = playlist.filter(
      (item) =>
        item.createdBy === userId &&
        item.sourceUrl.trim() === sourceUrl &&
        !probedItemIds.has(item.id),
    )
    if (matches.length === 0) {
      // Item may not have arrived yet — keep pending.
      return null
    }

    pendingSourceUrls.shift()
    // Prefer the newest match when the same URL was added more than once.
    const item = matches.reduce((latest, entry) =>
      entry.createdAt >= latest.createdAt ? entry : latest,
    )
    const needs = playlistItemNeedsNativeMetadata(item)
    if (!needs.needsTitle && !needs.needsDuration) {
      probedItemIds.add(item.id)
      continue
    }

    probedItemIds.add(item.id)
    emit()
    return { item, ...needs }
  }
  return null
}

/** Test-only: reset session probe bookkeeping. */
export function resetNativePlaylistMetadataProbeStateForTests(): void {
  probedItemIds.clear()
  pendingSourceUrls.length = 0
  listeners.clear()
}
