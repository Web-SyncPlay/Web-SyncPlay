import { afterEach, expect, test } from "bun:test"
import { setRoomBroadcastBusForTests } from "@/server/realtime/broadcast/room-broadcast-bus"
import type { RoomState } from "@/zod/types"
import { cleanupInactiveRooms } from "./cleanup"

afterEach(() => {
  setRoomBroadcastBusForTests(null)
})

function createState(): RoomState {
  return {
    roomId: "room-1",
    ownerId: "owner",
    roomSecurity: {
      joinPasswordEnabled: false,
      joinPasswordUpdatedAt: null,
      admissionVersion: 0,
      defaultJoinRole: "moderator",
    },
    playback: {
      paused: true,
      playbackRate: 1,
      timelineAnchorMs: 0,
      serverNowMs: Date.now(),
      videoLoop: "off",
      playlistLoop: "off",
      shuffle: false,
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
      mod: {
        userId: "mod",
        username: "Mod",
        avatarStyle: "adventurer",
        role: "moderator",
        connected: true,
        joinedAt: 2,
        localPlayback: {
          paused: true,
          currentTimeMs: 0,
          loading: false,
          updatedAt: Date.now(),
        },
      },
    },
    history: [],
    actionLog: [],
    updatedAt: Date.now(),
    generation: 0,
    structuralRevision: 0,
  }
}

test("cleanup reassigns owner when owner loses presence (grace keeps participant)", async () => {
  const state = createState()

  const fakeStore = {
    listRoomIds: async () => ["room-1"],
    delete: async () => undefined,
    getWsPresenceUserIds: async () => new Set<string>(["mod"]),
    updateRoom: async (
      roomId: string,
      mutate: (
        current: RoomState | null,
      ) => Promise<RoomState | null> | RoomState | null,
    ) => {
      const next = await mutate(roomId === "room-1" ? state : null)
      if (next) {
        Object.assign(state, next)
      }
      return next
    },
  }

  await cleanupInactiveRooms(fakeStore as never)

  expect(state.ownerId).toBe("mod")
  expect(state.participants.mod?.role).toBe("owner")
  expect(state.participants.owner?.connected).toBe(false)
  expect(state.participants.owner).toBeDefined()
})

test("cleanup removes participants past prune grace", async () => {
  const state = createState()
  const owner = state.participants.owner
  if (owner) {
    owner.connected = false
    owner.disconnectedAt = Date.now() - 120_000
  }

  const fakeStore = {
    listRoomIds: async () => ["room-1"],
    delete: async () => undefined,
    getWsPresenceUserIds: async () => new Set<string>(["mod"]),
    updateRoom: async (
      roomId: string,
      mutate: (
        current: RoomState | null,
      ) => Promise<RoomState | null> | RoomState | null,
    ) => {
      const next = await mutate(roomId === "room-1" ? state : null)
      if (next) {
        Object.assign(state, next)
      }
      return next
    },
  }

  const result = await cleanupInactiveRooms(fakeStore as never)

  expect(result.removedParticipants).toBe(1)
  expect(state.participants.owner).toBeUndefined()
  expect(state.ownerId).toBe("mod")
})

test("cleanup marks everyone offline when WS presence is empty (crash ghosts)", async () => {
  const state = createState()
  let deleted = false

  const fakeStore = {
    listRoomIds: async () => ["room-1"],
    delete: async () => {
      deleted = true
    },
    getWsPresenceUserIds: async () => new Set<string>(),
    updateRoom: async (
      roomId: string,
      mutate: (
        current: RoomState | null,
      ) => Promise<RoomState | null> | RoomState | null,
    ) => {
      const next = await mutate(roomId === "room-1" ? state : null)
      if (next === null && deleted) {
        return null
      }
      if (next) {
        Object.assign(state, next)
      }
      return next
    },
  }

  await cleanupInactiveRooms(fakeStore as never)

  expect(state.participants.owner?.connected).toBe(false)
  expect(state.participants.mod?.connected).toBe(false)
  expect(deleted).toBe(false)
})

