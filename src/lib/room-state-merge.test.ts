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
})
