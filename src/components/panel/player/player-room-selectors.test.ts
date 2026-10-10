import { expect, test } from "bun:test"
import { applyPresenceBatches } from "@/client/realtime/room-state-merge"
import {
  createParticipant,
  createPlaylistItem,
  createRoomState,
} from "@/shared/test-utils/room-fixtures"
import type { RoomState } from "@/contracts/types"
import {
  playerShellSlicesEqual,
  selectOwnerConnected,
  selectPlayerShellSlice,
  selectRemoteSeekerName,
  selectViewerItemPrefs,
} from "./player-room-selectors"

test("shell slice stays equal across presence-only lastSeen churn", () => {
  const prev = createRoomState()
  const before = selectPlayerShellSlice(prev, "guest")

  const next =
    applyPresenceBatches(prev, [
      {
        presenceRevision: (prev.presenceRevision ?? 0) + 1,
        serverNowMs: Date.now(),
        participants: { guest: { lastSeenAt: Date.now() + 1 } },
      },
    ]) ?? prev

  const after = selectPlayerShellSlice(next, "guest")
  expect(playerShellSlicesEqual(before, after)).toBe(true)
  // Playback / playlist identity preserved by presence merge.
  expect(after.playback).toBe(before.playback)
  expect(after.playlist).toBe(before.playlist)
  expect(after.currentItem).toBe(before.currentItem)
})

test("ownerConnected flips only when the local-file owner connect bit changes", () => {
  const localItem = createPlaylistItem({
    id: "local-1",
    name: "Local",
    sourceKind: "local_file",
    localOriginUserId: "owner",
    localMediaId: "lm-1",
  })
  const ownerOffline = createRoomState({
    playlist: [localItem],
    currentIndex: 0,
    participants: {
      owner: createParticipant({ userId: "owner", role: "owner", connected: false }),
      guest: createParticipant({ userId: "guest" }),
      mod: createParticipant({ userId: "mod", role: "moderator" }),
    },
  })
  expect(selectOwnerConnected(ownerOffline, localItem)).toBe(false)

  const ownerOnline =
    applyPresenceBatches(ownerOffline, [
      {
        presenceRevision: (ownerOffline.presenceRevision ?? 0) + 1,
        serverNowMs: Date.now(),
        participants: { owner: { connected: true } },
      },
    ]) ?? ownerOffline
  expect(selectOwnerConnected(ownerOnline, localItem)).toBe(true)

  // Unrelated participant presence must not affect the boolean.
  const guestTick =
    applyPresenceBatches(ownerOnline, [
      {
        presenceRevision: (ownerOnline.presenceRevision ?? 0) + 1,
        serverNowMs: Date.now(),
        participants: { guest: { lastSeenAt: Date.now() + 50 } },
      },
    ]) ?? ownerOnline
  expect(selectOwnerConnected(guestTick, localItem)).toBe(true)
})

test("remote seeker name is a string slice, not the participants map", () => {
  const base = createRoomState()
  const room = createRoomState({
    playback: {
      ...base.playback,
      seekPreview: {
        userId: "mod",
        targetMs: 1_000,
        active: true,
        updatedAt: Date.now(),
      },
    },
  })
  expect(selectRemoteSeekerName(room, room.playback.seekPreview)).toBe("Mod")
  expect(selectRemoteSeekerName(room, undefined)).toBe("Another user")
})

test("viewer prefs identity survives presence patch on the same user", () => {
  const base = createRoomState()
  const withPrefs: RoomState = {
    ...base,
    participants: {
      ...base.participants,
      guest: {
        ...base.participants.guest!,
        viewerMedia: {
          byItemId: {
            "item-a": { streamId: "s1" },
          },
        },
      },
    },
  }
  const before = selectViewerItemPrefs(withPrefs, "guest", "item-a")
  const next =
    applyPresenceBatches(withPrefs, [
      {
        presenceRevision: (withPrefs.presenceRevision ?? 0) + 1,
        serverNowMs: Date.now(),
        participants: { guest: { lastSeenAt: Date.now() + 9 } },
      },
    ]) ?? withPrefs
  const after = selectViewerItemPrefs(next, "guest", "item-a")
  expect(after).toBe(before)
})
