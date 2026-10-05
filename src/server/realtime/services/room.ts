import type { RoomStateStorePort } from "@/server/realtime/ports"
import { scheduleResolvingPlaylistItems } from "@/server/realtime/services/playlist-resolve"
import type { RoomState } from "@/zod/types"
import { randomUUID } from "node:crypto"
import { createDefaultRoomSecurity } from "./room-security"

export { scheduleResolvingPlaylistItems }

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
