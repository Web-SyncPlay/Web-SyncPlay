import type { RoomState } from "@/contracts/types"
import type { RoomStateStorePort } from "@/server/ports"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  buildSanitizedSnapshot,
  resetSnapshotCacheForTests,
} from "./snapshot-build"

beforeEach(() => {
  resetSnapshotCacheForTests()
})

afterEach(() => {
  resetSnapshotCacheForTests()
})

function minimalState(overrides?: Partial<RoomState>): RoomState {
  return {
    roomId: "room-1",
    ownerId: "owner",
    roomSecurity: {
      joinPasswordEnabled: false,
      joinPasswordUpdatedAt: null,
      admissionVersion: 0,
      defaultJoinRole: "guest",
    },
    playback: {
      paused: true,
      playbackRate: 1,
      timelineAnchorMs: 0,
      serverNowMs: Date.now(),
      videoLoop: "off",
      playlistLoop: "off",
    },
    playlist: [],
    currentIndex: 0,
    participants: {
      owner: {
        userId: "owner",
        username: "Owner",
        avatarStyle: "adventurer",
        role: "owner",
        connected: true,
        joinedAt: 1,
        localPlayback: {
          paused: true,
          currentTimeMs: 0,
          loading: false,
          updatedAt: Date.now(),
        },
      },
    },
    actionLog: [],
    updatedAt: Date.now(),
    generation: 3,
    structuralRevision: 5,
    ...overrides,
  }
}

describe("buildSanitizedSnapshot", () => {
  test("parallel fetch and short-lived cache hit", async () => {
    // Unique room id so a live Valkey presenceSeq (CI) does not collide.
    const roomId = `snap-cache-${crypto.randomUUID()}`
    let getCalls = 0
    const state = minimalState({ roomId })
    const store = {
      get: async () => {
        getCalls += 1
        return { ...state }
      },
      getPresenceDataAll: async () => ({}),
    } as unknown as RoomStateStorePort

    const first = await buildSanitizedSnapshot(store, roomId)
    const second = await buildSanitizedSnapshot(store, roomId)

    expect(first).not.toBeNull()
    expect(second).toBe(first)
    expect(first?.generation).toBe(3)
    expect(first?.presenceRevision).toBe(second?.presenceRevision)
    expect(getCalls).toBe(1)
  })
})
