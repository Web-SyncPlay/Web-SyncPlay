import type { RoomState } from "@/contracts/types"
import { expect, test } from "bun:test"
import {
  clearJoinPassword,
  createDefaultRoomSecurity,
  ensureRoomSecurity,
  evaluateJoinAdmission,
  sanitizeRoomStateForClient,
  setDefaultJoinRole,
  setJoinPassword,
} from "./room-security"

function createState(): RoomState {
  return {
    roomId: "room-1",
    ownerId: "owner",
    roomSecurity: createDefaultRoomSecurity(),
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

test("allows join when room has no password", async () => {
  const state = createState()

  expect(await evaluateJoinAdmission(state)).toEqual({ allowed: true })
})

test("requires a password for protected rooms and rejects wrong passwords", async () => {
  const state = createState()
  await setJoinPassword(state, "secret-pass")

  expect(await evaluateJoinAdmission(state)).toEqual({
    allowed: false,
    reason: "password_required",
  })
  expect(await evaluateJoinAdmission(state, "wrong-pass")).toEqual({
    allowed: false,
    reason: "invalid_password",
  })
  expect(await evaluateJoinAdmission(state, "secret-pass")).toEqual({
    allowed: true,
  })
})

test("sanitizes hashed password fields before broadcasting room state", async () => {
  const state = createState()
  await setJoinPassword(state, "secret-pass")

  const sanitized = sanitizeRoomStateForClient(state)

  expect(sanitized.roomSecurity.joinPasswordEnabled).toBe(true)
  expect(sanitized.roomSecurity.defaultJoinRole).toBe("guest")
  expect(typeof sanitized.roomSecurity.joinPasswordUpdatedAt).toBe("number")
  expect("joinPasswordHash" in sanitized.roomSecurity).toBe(false)
  expect("joinPasswordSalt" in sanitized.roomSecurity).toBe(false)
})

test("default join role defaults to guest and can be set to moderator", () => {
  const state = createState()
  expect(state.roomSecurity.defaultJoinRole).toBe("guest")

  expect(setDefaultJoinRole(state, "moderator")).toBe(true)
  expect(state.roomSecurity.defaultJoinRole).toBe("moderator")
  expect(setDefaultJoinRole(state, "moderator")).toBe(false)
})

test("clearing the password disables future admission checks", async () => {
  const state = createState()
  await setJoinPassword(state, "secret-pass")

  const changed = clearJoinPassword(state)

  expect(changed).toBe(true)
  expect(state.roomSecurity.joinPasswordEnabled).toBe(false)
  expect(await evaluateJoinAdmission(state)).toEqual({ allowed: true })
})

test("ensureRoomSecurity disables protection when hash/salt are missing", async () => {
  const state = createState()
  state.roomSecurity = {
    ...createDefaultRoomSecurity(),
    joinPasswordEnabled: true,
  }

  const security = ensureRoomSecurity(state)

  expect(security.joinPasswordEnabled).toBe(false)
  expect(await evaluateJoinAdmission(state)).toEqual({ allowed: true })
})
