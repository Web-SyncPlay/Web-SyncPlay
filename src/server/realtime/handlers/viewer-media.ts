import {
  VIEWER_MEDIA_BY_ITEM_LIMIT,
  type PlaylistItem,
  type ViewerMediaItemPreference,
  type ViewerMediaPreferences,
} from "@/contracts/types"
import { viewerMediaPreferencesSchema } from "@/contracts/schemas"
import type { z } from "zod"
import { mutateRoomMessage } from "./mutate-room"
import { parseOrNack } from "./parse-or-nack"
import type { RoomMessageHandler } from "./types"

type ViewerMediaPreferencesInput = z.infer<typeof viewerMediaPreferencesSchema>

export function capViewerMediaByItemId(
  prefs: ViewerMediaPreferences,
  limit = VIEWER_MEDIA_BY_ITEM_LIMIT,
): ViewerMediaPreferences {
  const entries = Object.entries(prefs.byItemId)
  if (entries.length <= limit) {
    return prefs
  }
  return {
    byItemId: Object.fromEntries(entries.slice(-limit)),
  }
}

function catalogHasId(
  entries: ReadonlyArray<{ id: string }> | undefined,
  id: string,
): boolean {
  return entries?.some((entry) => entry.id === id) === true
}

/**
 * Merge a preferences patch onto an existing item preference.
 * Returns `null` when a referenced stream/text-track id is not in the catalog.
 */
export function mergeViewerMediaItemPreference(
  item: PlaylistItem,
  previous: ViewerMediaItemPreference | undefined,
  patch: ViewerMediaPreferencesInput,
): ViewerMediaItemPreference | null {
  const next: ViewerMediaItemPreference = { ...(previous ?? {}) }

  if (patch.streamId !== undefined) {
    if (
      patch.streamId !== null &&
      !catalogHasId(item.mediaStreams, patch.streamId)
    ) {
      return null
    }
    next.streamId = patch.streamId ?? undefined
  }

  if (patch.textTrackId !== undefined) {
    if (
      patch.textTrackId !== null &&
      !catalogHasId(item.textTracks, patch.textTrackId)
    ) {
      return null
    }
    next.textTrackId = patch.textTrackId
  }

  if (patch.audioLanguage !== undefined) {
    next.audioLanguage = patch.audioLanguage || undefined
  }

  return next
}

export function applyViewerMediaPreferences(
  participant: { viewerMedia?: ViewerMediaPreferences },
  item: PlaylistItem,
  patch: ViewerMediaPreferencesInput,
): boolean {
  const next = mergeViewerMediaItemPreference(
    item,
    participant.viewerMedia?.byItemId[patch.itemId],
    patch,
  )
  if (!next) return false

  participant.viewerMedia = capViewerMediaByItemId({
    byItemId: {
      ...(participant.viewerMedia?.byItemId ?? {}),
      [patch.itemId]: next,
    },
  })
  return true
}

export const handleViewerMediaPreferences: RoomMessageHandler = async (
  ctx,
  data,
) => {
  const parsed = parseOrNack(
    viewerMediaPreferencesSchema,
    ctx.ws,
    data,
  )
  if (!parsed) return

  await mutateRoomMessage(
    ctx.store,
    ctx.roomId,
    ctx.userId,
    (state) => {
      const participant = state.participants[ctx.userId]
      if (!participant) return false

      const item = state.playlist.find((entry) => entry.id === parsed.itemId)
      if (!item) return false

      if (!applyViewerMediaPreferences(participant, item, parsed)) {
        return false
      }

      state.updatedAt = Date.now()
      return true
    },
    { kind: "snapshot" },
  )
}
