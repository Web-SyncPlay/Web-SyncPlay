import { randomUUID } from "node:crypto"

import type { RoomState } from "@/contracts/types"
import type { RoomStateStorePort } from "@/server/ports"
import { scheduleResolvingPlaylistItems } from "@/server/realtime/services/playlist-resolve"
import { assertPublicHttpUrl } from "@/server/security/url-safety"

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
 * Create-time `?media=` / join `initialMediaUrl` / `skipDefaultMedia` gate.
 * Existing rooms ignore the seed. New rooms with an explicit seed must pass SSRF checks.
 */
export function evaluateCreateMediaSeed(input: {
  roomExists: boolean
  initialMediaUrl?: string
  skipDefaultMedia?: boolean
}):
  | { ok: true; seedUrl?: string; skipDefaultMedia?: boolean }
  | { ok: false; reason: "media_url_unsupported" } {
  if (input.roomExists) {
    return { ok: true }
  }
  if (input.initialMediaUrl !== undefined) {
    const safety = assertPublicHttpUrl(input.initialMediaUrl)
    if (!safety.ok) {
      return { ok: false, reason: "media_url_unsupported" }
    }
    return { ok: true, seedUrl: safety.url.href }
  }
  if (input.skipDefaultMedia) {
    return { ok: true, skipDefaultMedia: true }
  }
  return { ok: true }
}

export async function createInitialRoomState(
  store: RoomStateStorePort,
  roomId: string,
  ownerId: string,
  options?: { initialMediaUrl?: string; skipDefaultMedia?: boolean },
): Promise<RoomState> {
  const seededUrl = options?.initialMediaUrl?.trim()
  let playlist: ReturnType<typeof playlistItemFromUrl>[]
  if (seededUrl && assertPublicHttpUrl(seededUrl).ok) {
    playlist = [
      playlistItemFromUrl({
        url: seededUrl,
        name: seededUrl,
        ownerId,
      }),
    ]
  } else if (options?.skipDefaultMedia) {
    playlist = []
  } else {
    playlist = (await store.getDailyDefaults()).map((entry) =>
      playlistItemFromUrl({
        url: entry.url,
        name: entry.title,
        ownerId,
      }),
    )
  }

  // Do not resolve here — callers must persist the room first, then call
  // scheduleResolvingPlaylistItems. Starting resolve inside create races the
  // join WATCH/SET and can leave native URLs stuck on "resolving" forever.

  const empty = playlist.length === 0

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
      // first paint after room creation / navigation. Empty create (local
      // handoff) stays paused until the first item is added. Clients stay
      // muted by default to satisfy browser autoplay policy.
      paused: empty,
      playbackRate: 1,
      timelineAnchorMs: 0,
      serverNowMs: Date.now(),
      videoLoop: "off",
      playlistLoop: "off",
    },
  } satisfies RoomState
}
