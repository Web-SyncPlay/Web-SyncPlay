import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import type { RoomState } from "@/contracts/types"
import type { RoomStateStorePort } from "@/server/ports"

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
  test("short-lived cache hit when generation and structuralRevision match", async () => {
    // Unique room id so a live Valkey presenceSeq (CI) does not collide.
    const roomId = `snap-cache-${crypto.randomUUID()}`
    let getCalls = 0
    let overlayCalls = 0
    const state = minimalState({ roomId })
    const store = {
      get: async () => {
        getCalls += 1
        return { ...state }
      },
      getPresenceDataAll: async () => {
        overlayCalls += 1
        return {}
      },
    } as unknown as RoomStateStorePort

    const first = await buildSanitizedSnapshot(store, roomId)
    const second = await buildSanitizedSnapshot(store, roomId)

    expect(first).not.toBeNull()
    expect(second).toBe(first)
    expect(first?.generation).toBe(3)
    expect(first?.presenceRevision).toBe(second?.presenceRevision)
    // Cache hit still revalidates via store.get; overlay/sanitize skipped.
    expect(getCalls).toBe(2)
    expect(overlayCalls).toBe(1)
  })

  test("cache miss when structural revision advances (join)", async () => {
    const roomId = `snap-struct-${crypto.randomUUID()}`
    let generation = 3
    let structuralRevision = 5
    const participants: RoomState["participants"] = {
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
    }
    const store = {
      get: async () =>
        minimalState({
          roomId,
          generation,
          structuralRevision,
          participants: { ...participants },
        }),
      getPresenceDataAll: async () => ({}),
    } as unknown as RoomStateStorePort

    const first = await buildSanitizedSnapshot(store, roomId)
    expect(first?.participants.guest).toBeUndefined()

    // Simulate join commit: bump structure and add guest before next snapshot.
    generation = 4
    structuralRevision = 6
    participants.guest = {
      userId: "guest",
      username: "Guest",
      avatarStyle: "adventurer",
      role: "guest",
      connected: true,
      joinedAt: 2,
      localPlayback: {
        paused: true,
        currentTimeMs: 0,
        loading: false,
        updatedAt: Date.now(),
      },
    }

    const second = await buildSanitizedSnapshot(store, roomId)
    expect(second).not.toBe(first)
    expect(second?.participants.guest?.role).toBe("guest")
    expect(second?.generation).toBe(4)
  })
})
