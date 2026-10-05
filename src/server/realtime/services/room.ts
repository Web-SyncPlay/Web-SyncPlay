import { resolveMediaSource } from "@/server/media/resolve"
import type { RoomStateStorePort } from "@/server/realtime/ports"
import { repairCleanupAndCheckRoomState } from "@/server/repair"
import type { PlaylistItem, RoomState } from "@/zod/types"
import { randomUUID } from "node:crypto"
import { normalizeParticipantRoles } from "./permissions"
import { createDefaultRoomSecurity } from "./room-security"

/** Dedupes concurrent resolve kicks for the same playlist item. */
const inflightPlaylistResolves = new Set<string>()

async function applyResolvedSeedItem(
  store: RoomStateStorePort,
  roomId: string,
  itemId: string,
  title: string,
  resolved: Awaited<ReturnType<typeof resolveMediaSource>>,
) {
  // Retry briefly: native YouTube resolve can finish before the creating
  // join transaction has committed the room key to Redis.
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const written = await store.updateRoom(roomId, async (state) => {
      if (!state) return null
      const item = state.playlist.find((entry) => entry.id === itemId)
      // Item removed or already settled — commit no-op and stop retrying.
      if (!item || item.ingestStatus !== "resolving") return state
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

    if (written) {
      return
    }

    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(25 * 2 ** Math.min(attempt, 4), 200)),
    )
  }
}

async function resolvePlaylistItemInBackground(
  store: RoomStateStorePort,
  roomId: string,
  itemId: string,
  sourceUrl: string,
  title: string,
) {
  const key = `${roomId}:${itemId}`
  try {
    const resolved = await resolveMediaSource({
      url: sourceUrl,
      name: title,
      roomId,
      mediaId: itemId,
    })
    await applyResolvedSeedItem(store, roomId, itemId, title, resolved)
  } catch {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const written = await store.updateRoom(roomId, async (state) => {
        if (!state) return null
        const item = state.playlist.find((entry) => entry.id === itemId)
        if (!item || item.ingestStatus !== "resolving") return null
        item.ingestStatus = "error"
        item.ingestError = "Failed to resolve default media"
        state.updatedAt = Date.now()
        return state
      })
      if (written) return
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(25 * 2 ** Math.min(attempt, 4), 200)),
      )
    }
  } finally {
    inflightPlaylistResolves.delete(key)
  }
}

/**
 * Start background resolve for playlist items still in `resolving`.
 * Safe to call after the room has been persisted (e.g. post-join).
 */
export function scheduleResolvingPlaylistItems(
  store: RoomStateStorePort,
  roomId: string,
  playlist: PlaylistItem[],
) {
  for (const item of playlist) {
    if (item.ingestStatus !== "resolving") continue
    if (item.sourceKind === "local_file") continue
    const key = `${roomId}:${item.id}`
    if (inflightPlaylistResolves.has(key)) continue
    inflightPlaylistResolves.add(key)
    void resolvePlaylistItemInBackground(
      store,
      roomId,
      item.id,
      item.sourceUrl,
      item.name,
    )
  }
}

export async function createInitialRoomState(
  store: RoomStateStorePort,
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

  // Do not resolve here — callers must persist the room first, then call
  // scheduleResolvingPlaylistItems. Starting resolve inside create races the
  // join WATCH/SET and can leave native URLs stuck on "resolving" forever.

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
  store: RoomStateStorePort,
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
