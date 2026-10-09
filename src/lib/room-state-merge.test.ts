import { describe, expect, test } from "bun:test"
import {
  applyPresenceBatch,
  applyRoomControl,
  applyRoomSnapshot,
} from "@/lib/room-state-merge"
import { createRoomState } from "@/server/realtime/test-utils/fixtures"

describe("room-state-merge", () => {
  test("control ignores older generation", () => {
    const prev = createRoomState({ generation: 5 })
    const next = applyRoomControl(prev, {
      generation: 4,
      currentIndex: 2,
      updatedAt: Date.now(),
      playback: { ...prev.playback, paused: false },
    })
    expect(next?.generation).toBe(5)
    expect(next?.currentIndex).toBe(0)
  })

  test("presence merge reuses playlist reference", () => {
    const prev = createRoomState()
    const next = applyPresenceBatch(prev, {
      presenceRevision: 1,
      serverNowMs: Date.now(),
      participants: {
        guest: {
          localPlayback: {
            paused: false,
            currentTimeMs: 999,
            loading: false,
            updatedAt: Date.now(),
          },
        },
      },
    })
    expect(next?.playlist).toBe(prev.playlist)
    expect(next?.participants.guest?.localPlayback.currentTimeMs).toBe(999)
  })

  test("presence merge preserves identity fields when patch omits them", () => {
    const prev = createRoomState()
    const next = applyPresenceBatch(prev, {
      presenceRevision: 1,
      serverNowMs: Date.now(),
      participants: {
        guest: {
          connected: false,
          lastSeenAt: 42,
        },
      },
    })
    expect(next?.participants.guest?.username).toBe(
      prev.participants.guest?.username,
    )
    expect(next?.participants.guest?.avatarStyle).toBe(
      prev.participants.guest?.avatarStyle,
    )
    expect(next?.participants.guest?.connected).toBe(false)
    expect(next?.participants.guest?.lastSeenAt).toBe(42)
  })

  test("late snapshot does not rewind newer control playback", () => {
    const base = createRoomState({ generation: 1 })
    const afterControl = applyRoomControl(base, {
      generation: 3,
      currentIndex: 1,
      updatedAt: Date.now(),
      playback: {
        ...base.playback,
        timelineAnchorMs: 50_000,
        paused: false,
      },
    })!
    const afterSnapshot = applyRoomSnapshot(afterControl, {
      ...base,
      generation: 2,
      structuralRevision: 2,
      currentIndex: 0,
      playback: {
        ...base.playback,
        timelineAnchorMs: 0,
        paused: true,
      },
    })
    expect(afterSnapshot.playback.timelineAnchorMs).toBe(50_000)
    expect(afterSnapshot.currentIndex).toBe(1)
    expect(afterSnapshot.generation).toBe(3)
  })

  test("control remaps decremented index via mediaId when playlist is stale", () => {
    // Playing B at index 1; server removed A and sent control with index 0
    // before the snapshot updates the playlist.
    const prev = createRoomState({
      generation: 1,
      currentIndex: 1,
      playback: {
        ...createRoomState().playback,
        mediaId: "item-b",
      },
    })
    const next = applyRoomControl(prev, {
      generation: 2,
      currentIndex: 0,
      updatedAt: Date.now(),
      playback: {
        ...prev.playback,
        mediaId: "item-b",
      },
    })
    expect(next?.currentIndex).toBe(1)
    expect(next?.playlist[next.currentIndex]?.id).toBe("item-b")
    expect(next?.playback.mediaId).toBe("item-b")
  })

  test("control resolves delete-current mediaId against stale playlist", () => {
    // Playing B at index 1; server removed B, advanced to C (mediaId), and
    // sent control before the snapshot drops B from the playlist.
    const prev = createRoomState({
      generation: 1,
      currentIndex: 1,
      playback: {
        ...createRoomState().playback,
        mediaId: "item-b",
      },
    })
    const next = applyRoomControl(prev, {
      generation: 2,
      currentIndex: 1,
      updatedAt: Date.now(),
      playback: {
        ...prev.playback,
        mediaId: "item-c",
        timelineAnchorMs: 0,
      },
    })
    expect(next?.currentIndex).toBe(2)
    expect(next?.playlist[next.currentIndex]?.id).toBe("item-c")
    expect(next?.playback.mediaId).toBe("item-c")
  })

  test("control keeps previous index when mediaId is absent from playlist", () => {
    const prev = createRoomState({
      generation: 1,
      currentIndex: 1,
      playback: {
        ...createRoomState().playback,
        mediaId: "item-b",
      },
    })
    const next = applyRoomControl(prev, {
      generation: 2,
      currentIndex: 0,
      updatedAt: Date.now(),
      playback: {
        ...prev.playback,
        mediaId: "missing-item",
      },
    })
    expect(next?.currentIndex).toBe(1)
    expect(next?.playback.mediaId).toBe("missing-item")
  })
})
