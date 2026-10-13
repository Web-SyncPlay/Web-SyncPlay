import type { RoomState } from "@/contracts/types"
import type { RoomStateStorePort } from "@/server/ports"
import { afterEach, describe, expect, mock, test } from "bun:test"

afterEach(() => {
  mock.restore()
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
    mock.module("@/server/realtime/broadcast/presence-seq", () => ({
      peekPresenceRevision: async () => 9,
      nextPresenceRevision: async () => 10,
      clearPresenceSeqFallback: () => {},
      resetPresenceSeqFallbackForTests: () => {},
    }))

    const { buildSanitizedSnapshot, resetSnapshotCacheForTests } =
      await import("@/server/realtime/broadcast/snapshot-build")
    resetSnapshotCacheForTests()

    let getCalls = 0
    const state = minimalState()
    const store = {
      get: async () => {
        getCalls += 1
        return { ...state }
      },
      getPresenceDataAll: async () => ({}),
    } as unknown as RoomStateStorePort

    const first = await buildSanitizedSnapshot(store, "room-1")
    const second = await buildSanitizedSnapshot(store, "room-1")

    expect(first).not.toBeNull()
    expect(second).toBe(first)
    expect(first?.generation).toBe(3)
    expect(first?.presenceRevision).toBe(9)
    expect(getCalls).toBe(1)
  })
})
