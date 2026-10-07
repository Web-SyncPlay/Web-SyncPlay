import { describe, expect, test } from "bun:test"
import {
  commitPlaybackSeek,
  nextMonotonicMs,
  reanchorPlaybackAtNow,
  resetPlaybackTimeline,
  resolveCurrentTimelineMs,
} from "./timeline"
import { createRoomState } from "@/server/realtime/test-utils/fixtures"

describe("timeline helpers", () => {
  test("nextMonotonicMs never moves backwards", () => {
    expect(nextMonotonicMs(100, 50)).toBe(101)
    expect(nextMonotonicMs(100, 100)).toBe(101)
    expect(nextMonotonicMs(100, 200)).toBe(200)
  })

  test("resolveCurrentTimelineMs holds when paused", () => {
    const state = createRoomState()
    state.playback.paused = true
    state.playback.timelineAnchorMs = 5_000
    state.playback.serverNowMs = 1_000
    expect(resolveCurrentTimelineMs(state, 9_000)).toBe(5_000)
  })

  test("commitPlaybackSeek snaps timeline and clears seekPreview", () => {
    const state = createRoomState()
    state.playback.paused = false
    state.playback.timelineAnchorMs = 1_000
    state.playback.serverNowMs = 10_000
    state.playback.playbackRate = 1
    state.playback.seekPreview = {
      userId: "owner",
      targetMs: 2_000,
      active: true,
      updatedAt: 10_000,
    }

    const { fromMs, toMs } = commitPlaybackSeek(state, 8_500, 12_000)
    expect(fromMs).toBe(3_000)
    expect(toMs).toBe(8_500)
    expect(state.playback.timelineAnchorMs).toBe(8_500)
    expect(state.playback.serverNowMs).toBe(12_000)
    expect(state.playback.seekPreview).toBeUndefined()
  })

  test("reanchorPlaybackAtNow freezes projected playhead", () => {
    const state = createRoomState()
    state.playback.paused = false
    state.playback.timelineAnchorMs = 2_000
    state.playback.serverNowMs = 5_000
    state.playback.playbackRate = 2

    reanchorPlaybackAtNow(state, 6_000)
    expect(state.playback.timelineAnchorMs).toBe(4_000)
    expect(state.playback.serverNowMs).toBe(6_000)
  })

  test("resetPlaybackTimeline zeros anchor and optionally pauses", () => {
    const state = createRoomState()
    state.playback.paused = false
    state.playback.timelineAnchorMs = 5_000
    state.playback.serverNowMs = 1_000

    resetPlaybackTimeline(state, 2_000)
    expect(state.playback.timelineAnchorMs).toBe(0)
    expect(state.playback.serverNowMs).toBe(2_000)
    expect(state.playback.paused).toBe(false)

    resetPlaybackTimeline(state, 3_000, { pause: true })
    expect(state.playback.paused).toBe(true)
    expect(state.playback.serverNowMs).toBe(3_000)
  })
})
