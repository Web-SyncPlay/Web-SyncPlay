import { expect, test } from "bun:test"
import type { RoomState } from "@/contracts/types"
import { transferOwnershipIfNeeded } from "./ownership"

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
      videoLoop: "off" as const,
      playlistLoop: "off" as const,
    },
    playlist: [],
    currentIndex: 0,
    participants: {
      owner: {
        userId: "owner",
        username: "Owner",
        avatarStyle: "adventurer",
        role: "owner",
        connected: false,
        joinedAt: 1,
        localPlayback: {
          paused: true,
          currentTimeMs: 0,
          loading: false,
          updatedAt: Date.now(),
        },
      },
      modNew: {
        userId: "modNew",
        username: "Mod New",
        avatarStyle: "adventurer",
        role: "moderator",
        connected: true,
        joinedAt: 20,
        localPlayback: {
          paused: true,
          currentTimeMs: 0,
          loading: false,
          updatedAt: Date.now(),
        },
      },
      modOld: {
        userId: "modOld",
        username: "Mod Old",
        avatarStyle: "adventurer",
        role: "moderator",
        connected: true,
        joinedAt: 10,
        localPlayback: {
          paused: true,
          currentTimeMs: 0,
          loading: false,
          updatedAt: Date.now(),
        },
      },
      guestOld: {
        userId: "guestOld",
        username: "Guest Old",
        avatarStyle: "adventurer",
        role: "guest",
        connected: true,
        joinedAt: 5,
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
    generation: 0,
    structuralRevision: 0,
  }
}

test("transfers owner to longest-tenured connected moderator first", () => {
  const state = createState()
  const changed = transferOwnershipIfNeeded(state, "disconnect")

  expect(changed).toBe(true)
  expect(state.ownerId).toBe("modOld")
  expect(state.participants.modOld?.role).toBe("owner")
  expect(state.participants.owner?.role).toBe("guest")
})

test("falls back to longest-tenured guest when no moderator connected", () => {
  const state = createState()
  if (state.participants.modOld) state.participants.modOld.connected = false
  if (state.participants.modNew) state.participants.modNew.connected = false

  const changed = transferOwnershipIfNeeded(state, "cleanup")

  expect(changed).toBe(true)
  expect(state.ownerId).toBe("guestOld")
  expect(state.participants.guestOld?.role).toBe("owner")
})

test("does not change owner when current owner is still connected", () => {
  const state = createState()
  if (state.participants.owner) state.participants.owner.connected = true

  const changed = transferOwnershipIfNeeded(state, "disconnect")

  expect(changed).toBe(false)
  expect(state.ownerId).toBe("owner")
})

test("join reason transfers ownership when owner is offline", () => {
  const state = createState()
  const changed = transferOwnershipIfNeeded(state, "join")

  expect(changed).toBe(true)
  expect(state.ownerId).toBe("modOld")
  expect(
    state.actionLog.some(
      (e) =>
        e.action === "participant:owner:transferred" &&
        (e.payload as { reason?: string }).reason === "join",
    ),
  ).toBe(true)
})
