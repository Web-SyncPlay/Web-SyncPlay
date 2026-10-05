import { expect, test } from "bun:test"
import type { RoomState } from "@/zod/types"
import { cleanupInactiveRooms } from "./cleanup"

test("cleanup reassigns owner to connected moderator", async () => {
  const state: RoomState = {
    roomId: "room-1",
    ownerId: "owner",
    roomSecurity: {
      joinPasswordEnabled: false,
      joinPasswordUpdatedAt: null,
      admissionVersion: 0,
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

  await cleanupInactiveRooms(fakeStore as never)

  expect(state.ownerId).toBe("mod")
  expect(state.participants.mod?.role).toBe("owner")
  expect(state.participants.owner).toBeUndefined()
})
