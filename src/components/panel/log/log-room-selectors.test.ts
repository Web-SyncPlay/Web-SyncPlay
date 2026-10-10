import { expect, test } from "bun:test"
import { applyPresenceBatches } from "@/client/realtime/room-state-merge"
import {
  createParticipant,
  createRoomState,
} from "@/shared/test-utils/room-fixtures"
import type { ActionLogEntry, RoomState } from "@/contracts/types"
import {
  logShellSlicesEqual,
  participantUsernamesEqual,
  selectLogFilterUsers,
  selectLogShellSlice,
} from "./log-room-selectors"

function withLog(room: RoomState, entry: ActionLogEntry): RoomState {
  return { ...room, actionLog: [...room.actionLog, entry] }
}

test("log shell slice stays equal across presence-only lastSeen churn", () => {
  const prev = withLog(createRoomState(), {
    id: "log-1",
    at: Date.now(),
    roomId: "room-1",
    action: "playback:pause",
    actorUserId: "guest",
    actorUsername: "Guest",
    payload: {},
  })
  const before = selectLogShellSlice(prev)

  const next =
    applyPresenceBatches(prev, [
      {
        presenceRevision: (prev.presenceRevision ?? 0) + 1,
        serverNowMs: Date.now(),
        participants: {
          guest: { lastSeenAt: Date.now() + 1, connected: true },
          owner: { lastSeenAt: Date.now() + 2 },
        },
      },
    ]) ?? prev

  const after = selectLogShellSlice(next)
  expect(logShellSlicesEqual(before, after)).toBe(true)
  expect(after.actionLog).toBe(before.actionLog)
  expect(
    participantUsernamesEqual(
      before.participantUsernames,
      after.participantUsernames,
    ),
  ).toBe(true)
})

test("log shell slice flips when a username changes", () => {
  const base = createRoomState()
  const before = selectLogShellSlice(base)
  const renamed = {
    ...base,
    participants: {
      ...base.participants,
      guest: { ...base.participants.guest!, username: "Renamed" },
    },
  }
  expect(logShellSlicesEqual(before, selectLogShellSlice(renamed))).toBe(false)
})

test("log shell slice flips when actionLog identity changes", () => {
  const base = createRoomState()
  const before = selectLogShellSlice(base)
  const withEntry = withLog(base, {
    id: "log-2",
    at: Date.now(),
    roomId: "room-1",
    action: "playlist:add",
    actorUserId: "owner",
    payload: { itemName: "Clip" },
  })
  expect(logShellSlicesEqual(before, selectLogShellSlice(withEntry))).toBe(
    false,
  )
})

test("selectLogFilterUsers prefers actorUsername then participant map", () => {
  const room = withLog(
    createRoomState({
      participants: {
        guest: createParticipant({ userId: "guest", username: "LiveName" }),
      },
    }),
    {
      id: "log-3",
      at: Date.now(),
      roomId: "room-1",
      action: "participant:joined",
      actorUserId: "guest",
      payload: {},
    },
  )
  const slice = selectLogShellSlice(room)
  expect(selectLogFilterUsers(slice)).toEqual([
    { id: "guest", label: "LiveName" },
  ])

  const stamped = withLog(createRoomState(), {
    id: "log-4",
    at: Date.now(),
    roomId: "room-1",
    action: "participant:joined",
    actorUserId: "guest",
    actorUsername: "Stamped",
    payload: {},
  })
  expect(selectLogFilterUsers(selectLogShellSlice(stamped))).toEqual([
    { id: "guest", label: "Stamped" },
  ])
})
