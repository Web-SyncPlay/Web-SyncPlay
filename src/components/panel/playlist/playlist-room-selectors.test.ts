import { expect, test } from "bun:test"
import { applyPresenceBatches } from "@/client/realtime/room-state-merge"
import {
  createParticipant,
  createPlaylistItem,
  createRoomState,
} from "@/shared/test-utils/room-fixtures"
import {
  playlistShellSlicesEqual,
  selectPlaylistShellSlice,
} from "./playlist-room-selectors"

test("playlist shell slice stays equal across presence-only lastSeen churn", () => {
  const prev = createRoomState()
  const before = selectPlaylistShellSlice(prev, "guest")

  const next =
    applyPresenceBatches(prev, [
      {
        presenceRevision: (prev.presenceRevision ?? 0) + 1,
        serverNowMs: Date.now(),
        participants: { guest: { lastSeenAt: Date.now() + 1 } },
      },
    ]) ?? prev

  const after = selectPlaylistShellSlice(next, "guest")
  expect(playlistShellSlicesEqual(before, after)).toBe(true)
  expect(after.playlist).toBe(before.playlist)
  expect(after.currentItemId).toBe(before.currentItemId)
  expect(after.playlistLoop).toBe(before.playlistLoop)
  expect(after.myRole).toBe(before.myRole)
})

test("playlist shell slice flips when current item or loop changes", () => {
  const itemA = createPlaylistItem({ id: "a", name: "A" })
  const itemB = createPlaylistItem({ id: "b", name: "B" })
  const base = createRoomState({
    playlist: [itemA, itemB],
    currentIndex: 0,
    playback: {
      ...createRoomState().playback,
      mediaId: "a",
      playlistLoop: "off",
    },
  })
  const before = selectPlaylistShellSlice(base, "guest")

  const loopOn = {
    ...base,
    playback: { ...base.playback, playlistLoop: "once" as const },
  }
  expect(
    playlistShellSlicesEqual(before, selectPlaylistShellSlice(loopOn, "guest")),
  ).toBe(false)

  const nextItem = {
    ...base,
    currentIndex: 1,
    playback: { ...base.playback, mediaId: "b" },
  }
  expect(
    playlistShellSlicesEqual(
      before,
      selectPlaylistShellSlice(nextItem, "guest"),
    ),
  ).toBe(false)
})

test("playlist shell myRole flips only for that participant's role", () => {
  const base = createRoomState({
    participants: {
      guest: createParticipant({ userId: "guest", role: "guest" }),
      mod: createParticipant({ userId: "mod", role: "moderator" }),
    },
  })
  const before = selectPlaylistShellSlice(base, "guest")
  const afterModPresence =
    applyPresenceBatches(base, [
      {
        presenceRevision: (base.presenceRevision ?? 0) + 1,
        serverNowMs: Date.now(),
        participants: { mod: { lastSeenAt: Date.now() + 2, connected: false } },
      },
    ]) ?? base
  expect(
    playlistShellSlicesEqual(
      before,
      selectPlaylistShellSlice(afterModPresence, "guest"),
    ),
  ).toBe(true)

  const promoted = {
    ...base,
    participants: {
      ...base.participants,
      guest: { ...base.participants.guest!, role: "moderator" as const },
    },
  }
  expect(
    playlistShellSlicesEqual(
      before,
      selectPlaylistShellSlice(promoted, "guest"),
    ),
  ).toBe(false)
})
