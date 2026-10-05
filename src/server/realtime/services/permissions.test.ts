import assert from "node:assert/strict"
import test from "node:test"
import { canControlFromConnectionContext } from "./permissions"

const state = {
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
    videoLoop: "off" as const,
    playlistLoop: "off" as const,
    shuffle: false,
  },
  playlist: [],
  currentIndex: 0,
  participants: {
    owner: {
      userId: "owner",
      username: "Owner",
      avatarStyle: "adventurer",
      role: "owner" as const,
      connected: true,
      localPlayback: {
        paused: true,
        currentTimeMs: 0,
        loading: false,
        updatedAt: Date.now(),
      },
    },
    guest: {
      userId: "guest",
      username: "Guest",
      avatarStyle: "adventurer",
      role: "guest" as const,
      connected: true,
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

test("allows owner in room session", () => {
  assert.equal(
    canControlFromConnectionContext(state, "owner", {
      isControlSession: false,
      controlAuthorized: false,
    }),
    true,
  )
})

test("denies control session when identity verification failed", () => {
  assert.equal(
    canControlFromConnectionContext(state, "owner", {
      isControlSession: true,
      controlAuthorized: false,
    }),
    false,
  )
})

test("denies player embed session mutations", () => {
  assert.equal(
    canControlFromConnectionContext(state, "owner", {
      isControlSession: false,
      controlAuthorized: true,
      sessionKind: "player",
    }),
    false,
  )
})
