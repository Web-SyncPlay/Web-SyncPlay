import { expect, test } from "bun:test"
import { createDefaultRoomSecurity } from "@/server/realtime/services/room-security"
import {
  createDefaultPlayback,
  repairCleanupAndCheckRoomState,
  repairPlaylistState,
} from "@/server/repair"
import { createRoomState } from "@/server/realtime/test-utils/fixtures"
import type { RoomState } from "@/contracts/types"

function minimalRoomState(
  playlist: RoomState["playlist"],
): RoomState {
  return {
    roomId: "room-1",
    ownerId: "owner-1",
    roomSecurity: createDefaultRoomSecurity(),
    playlist,
    currentIndex: 0,
    structuralRevision: 0,
    generation: 0,
    updatedAt: 0,
    participants: {},
    playback: {
      paused: true,
      playbackRate: 1,
      timelineAnchorMs: 0,
      serverNowMs: 0,
      videoLoop: "off",
      playlistLoop: "off",
    },
    actionLog: [],
  }
}

test("repairPlaylistState migrates selected stream ids to defaults and strips legacy keys", () => {
  const state = minimalRoomState([
    {
      id: "item-1",
      name: "Video",
      sourceKind: "remote_url",
      playbackMode: "direct",
      sourceUrl: "https://example.com/v",
      playableUrl: "https://cdn.example/a.mp4",
      createdBy: "owner-1",
      createdAt: 1,
    },
  ])
  // Legacy Redis payloads may still carry pre-default* aliases.
  const legacyItem = state.playlist[0]! as typeof state.playlist[0] & {
    selectedStreamId?: string
    selectedTextTrackId?: string
  }
  legacyItem.selectedStreamId = "stream-old"
  legacyItem.selectedTextTrackId = "track-old"

  const findings = repairPlaylistState(state)
  const item = state.playlist[0]! as typeof state.playlist[0] & {
    selectedStreamId?: string
    selectedTextTrackId?: string
  }

  expect(findings).toContain("playlist-item-default-stream-migrated")
  expect(findings).toContain("playlist-item-default-text-track-migrated")
  expect(item.defaultStreamId).toBe("stream-old")
  expect(item.defaultTextTrackId).toBe("track-old")
  expect(item.selectedStreamId).toBeUndefined()
  expect(item.selectedTextTrackId).toBeUndefined()
})

test("repairCleanupAndCheckRoomState strips legacy history and shuffle", () => {
  const state = createRoomState()
  const legacy = state as typeof state & { history?: unknown }
  legacy.history = []
  ;(
    state.playback as typeof state.playback & { shuffle?: unknown }
  ).shuffle = true

  const findings = repairCleanupAndCheckRoomState(state)

  expect(findings).toContain("legacy-history-stripped")
  expect(findings).toContain("legacy-shuffle-stripped")
  expect(legacy.history).toBeUndefined()
  expect(
    (state.playback as { shuffle?: unknown }).shuffle,
  ).toBeUndefined()
})

test("repairCleanupAndCheckRoomState reconstructs missing playback object", () => {
  const state = createRoomState()
  // Corrupt Redis payloads may omit playback entirely.
  ;(state as { playback?: unknown }).playback = null

  const findings = repairCleanupAndCheckRoomState(state)

  expect(findings).toContain("playback-object-repaired")
  expect(state.playback.paused).toBe(true)
  expect(state.playback.playbackRate).toBe(1)
  expect(state.playback.timelineAnchorMs).toBe(0)
  expect(state.playback.videoLoop).toBe("off")
  expect(state.playback.playlistLoop).toBe("off")
  expect(typeof state.playback.serverNowMs).toBe("number")
  expect(createDefaultPlayback().playbackRate).toBe(1)
})

test("repairCleanupAndCheckRoomState reconstructs undefined playback object", () => {
  const state = createRoomState()
  delete (state as { playback?: unknown }).playback

  const findings = repairCleanupAndCheckRoomState(state)

  expect(findings).toContain("playback-object-repaired")
  expect(state.playback).toBeDefined()
  expect(typeof state.playback.serverNowMs).toBe("number")
})
