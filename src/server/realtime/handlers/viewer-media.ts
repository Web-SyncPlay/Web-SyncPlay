import {
  VIEWER_MEDIA_BY_ITEM_LIMIT,
  type ViewerMediaItemPreference,
  type ViewerMediaPreferences,
} from "@/zod/types"
import { viewerMediaPreferencesSchema } from "@/zod/schemas"
import { mutateRoomMessage } from "./mutate-room"
import type { RoomMessageHandler } from "./types"

function capByItemId(
  prefs: ViewerMediaPreferences,
): ViewerMediaPreferences {
  const entries = Object.entries(prefs.byItemId)
  if (entries.length <= VIEWER_MEDIA_BY_ITEM_LIMIT) {
    return prefs
  }
  return {
    byItemId: Object.fromEntries(entries.slice(-VIEWER_MEDIA_BY_ITEM_LIMIT)),
  }
}

export const handleViewerMediaPreferences: RoomMessageHandler = async (
  ctx,
  data,
) => {
  const parsed = viewerMediaPreferencesSchema.safeParse(data.payload)
  if (!parsed.success) return

  await mutateRoomMessage(
    ctx.store,
    ctx.roomId,
    ctx.userId,
    (state) => {
      const participant = state.participants[ctx.userId]
      if (!participant) return false

      const item = state.playlist.find((entry) => entry.id === parsed.data.itemId)
      if (!item) return false

      const next: ViewerMediaItemPreference = {
        ...(participant.viewerMedia?.byItemId[parsed.data.itemId] ?? {}),
      }

      if (parsed.data.streamId !== undefined) {
        if (
          parsed.data.streamId !== null &&
          !item.mediaStreams?.some(
            (stream) => stream.id === parsed.data.streamId,
          )
        ) {
          return false
        }
        next.streamId = parsed.data.streamId ?? undefined
      }

      if (parsed.data.textTrackId !== undefined) {
        if (
          parsed.data.textTrackId !== null &&
          !item.textTracks?.some((track) => track.id === parsed.data.textTrackId)
        ) {
          return false
        }
        next.textTrackId = parsed.data.textTrackId
      }

      if (parsed.data.audioLanguage !== undefined) {
        next.audioLanguage = parsed.data.audioLanguage || undefined
      }

      const byItemId = {
        ...(participant.viewerMedia?.byItemId ?? {}),
        [parsed.data.itemId]: next,
      }
      participant.viewerMedia = capByItemId({ byItemId })
      state.updatedAt = Date.now()
      return true
    },
    { kind: "snapshot" },
  )
}
