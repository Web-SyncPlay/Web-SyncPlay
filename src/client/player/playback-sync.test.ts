import { describe, expect, test } from "bun:test"
import {
  computeExpectedPlaybackTimeSec,
  measurePlaybackDriftSec,
} from "./playback-sync"

describe("measurePlaybackDriftSec", () => {
  test("returns absolute drift from the room clock", () => {
    const drift = measurePlaybackDriftSec(
      3,
      {
        paused: true,
        playbackRate: 1,
        timelineAnchorMs: 5_000,
        serverNowMs: 1_000,
      },
      1_000,
    )
    expect(drift).toBe(2)
  })

  test("accounts for elapsed time while playing", () => {
    const syncState = {
      paused: false,
      playbackRate: 1,
      timelineAnchorMs: 10_000,
      serverNowMs: 0,
    }
    expect(computeExpectedPlaybackTimeSec(syncState, 2_000)).toBe(12)
    expect(measurePlaybackDriftSec(11, syncState, 2_000)).toBe(1)
  })

  test("returns null for non-finite playhead", () => {
    expect(
      measurePlaybackDriftSec(Number.NaN, {
        paused: true,
        playbackRate: 1,
        timelineAnchorMs: 0,
        serverNowMs: 0,
      }),
    ).toBeNull()
  })
})
