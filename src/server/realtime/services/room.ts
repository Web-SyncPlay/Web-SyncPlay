import type { RoomStateStorePort } from "@/server/realtime/ports"
import { scheduleResolvingPlaylistItems } from "@/server/realtime/services/playlist-resolve"
import { assertPublicHttpUrl } from "@/server/security/url-safety"
import type { RoomState } from "@/zod/types"
import { randomUUID } from "node:crypto"
import { createDefaultRoomSecurity } from "./room-security"

export { scheduleResolvingPlaylistItems }

function playlistItemFromUrl(input: {
  url: string
  name: string
  ownerId: string
}) {
  return {
    id: randomUUID(),
    name: input.name,
    sourceKind: "remote_url" as const,
    playbackMode: "direct" as const,
    sourceUrl: input.url,
    playableUrl: input.url,
    ingestStatus: "resolving" as const,
    createdBy: input.ownerId,
    createdAt: Date.now(),
  }
}

/**
 * Create-time `?media=` / join `initialMediaUrl` gate.
 * Existing rooms ignore the seed. New rooms with an explicit seed must pass SSRF checks.
 */
export function evaluateCreateMediaSeed(input: {
  roomExists: boolean
  initialMediaUrl?: string
}):
  | { ok: true; seedUrl?: string }
  | { ok: false; reason: "media_url_unsupported" } {
  if (input.roomExists || input.initialMediaUrl === undefined) {
    return { ok: true }
  }
  const safety = assertPublicHttpUrl(input.initialMediaUrl)
  if (!safety.ok) {
    return { ok: false, reason: "media_url_unsupported" }
  }
  return { ok: true, seedUrl: safety.url.href }
}

export async function createInitialRoomState(
  store: RoomStateStorePort,
  roomId: string,
  ownerId: string,
  options?: { initialMediaUrl?: string },
): Promise<RoomState> {
  const seededUrl = options?.initialMediaUrl?.trim()
  const playlist =
    seededUrl && assertPublicHttpUrl(seededUrl).ok
      ? [
          playlistItemFromUrl({
            url: seededUrl,
            name: seededUrl,
            ownerId,
          }),
        ]
      : (await store.getDailyDefaults()).map((entry) =>
          playlistItemFromUrl({
            url: entry.url,
            name: entry.title,
            ownerId,
          }),
        )

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
    actionLog: [],
    participants: {},
    generation: 0,
    structuralRevision: 0,
    playback: {
      // Start playing so default (often YouTube) media can muted-autoplay on
      // first paint after room creation / navigation. Clients stay muted by
      // default to satisfy browser autoplay policy.
      paused: false,
      playbackRate: 1,
      timelineAnchorMs: 0,
      serverNowMs: Date.now(),
      videoLoop: "off",
      playlistLoop: "off",
    },
  } satisfies RoomState
}
