import { resolveMediaSource } from "@/server/media/resolve"
import type { RoomStateStore } from "@/server/redis/state-store"
import { repairCleanupAndCheckRoomState } from "@/server/repair"
import type { RoomState } from "@/zod/types"
import { randomUUID } from "node:crypto"
import { normalizeParticipantRoles } from "./permissions"
import { createDefaultRoomSecurity } from "./room-security"

async function resolveSeedItemInBackground(
  store: RoomStateStore,
  roomId: string,
  itemId: string,
  sourceUrl: string,
  title: string,
) {
  try {
    const resolved = await resolveMediaSource({
      url: sourceUrl,
      name: title,
      roomId,
      mediaId: itemId,
    })
    await store.updateRoom(roomId, async (state) => {
      if (!state) return null
      const item = state.playlist.find((entry) => entry.id === itemId)
      if (!item || item.ingestStatus !== "resolving") return null
      if (resolved.failureReason) {
        item.ingestStatus = "error"
        item.ingestError =
          resolved.resolveUserMessage ?? "Failed to resolve default media"
      } else {
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
        if (item.name.trim() === title.trim()) {
          item.name = resolved.title || title
        }
      }
      state.updatedAt = Date.now()
      return state
    })
  } catch {
    await store.updateRoom(roomId, async (state) => {
      if (!state) return null
      const item = state.playlist.find((entry) => entry.id === itemId)
      if (!item || item.ingestStatus !== "resolving") return null
      item.ingestStatus = "error"
      item.ingestError = "Failed to resolve default media"
      state.updatedAt = Date.now()
      return state
    })
  }
}

export async function createInitialRoomState(
  store: RoomStateStore,
  roomId: string,
  ownerId: string,
): Promise<RoomState> {
  const defaults = await store.getDailyDefaults()
  const playlist = defaults.map((entry) => {
    const itemId = randomUUID()
    return {
      id: itemId,
      name: entry.title,
      sourceKind: "remote_url" as const,
      playbackMode: "direct" as const,
      sourceUrl: entry.url,
      playableUrl: entry.url,
      ingestStatus: "resolving" as const,
      createdBy: ownerId,
      createdAt: Date.now(),
    }
  })

  // Fire-and-forget resolve so join is not blocked by yt-dlp.
  for (const item of playlist) {
    void resolveSeedItemInBackground(
      store,
      roomId,
      item.id,
      item.sourceUrl,
      item.name,
    )
  }

  return {
    roomId,
    ownerId,
    roomSecurity: createDefaultRoomSecurity(),
    currentIndex: 0,
    playlist,
    updatedAt: Date.now(),
    history: [],
    actionLog: [],
    participants: {},
    playback: {
      paused: true,
      playbackRate: 1,
      timelineAnchorMs: 0,
      serverNowMs: Date.now(),
      videoLoop: "off",
      playlistLoop: "off",
      shuffle: false,
    },
  } satisfies RoomState
}

export async function resolveRoom(
  store: RoomStateStore,
  roomId: string,
  ownerId: string,
): Promise<RoomState> {
  const existing = await store.get(roomId)
  if (existing) {
    normalizeParticipantRoles(existing)
    repairCleanupAndCheckRoomState(existing)
    return existing
  }

  return createInitialRoomState(store, roomId, ownerId)
}
