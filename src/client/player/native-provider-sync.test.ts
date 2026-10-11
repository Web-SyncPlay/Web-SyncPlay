import { describe, expect, test } from "bun:test"
import {
  createNativeSyncTracker,
  hasPlayheadMovedToward,
  isNativeDurationReady,
  NATIVE_MAX_VERIFY_FAILURES,
} from "./native-provider-sync"

describe("isNativeDurationReady", () => {
  test.each([
    [{ playerDurationSec: 0 }, false],
    [{ playerDurationSec: Number.NaN }, false],
    [{}, false],
    [{ playerDurationSec: 0, hintDurationSec: null }, false],
    [{ playerDurationSec: 19 }, true],
    [{ playerDurationSec: 0, hintDurationSec: 120 }, true],
    // Live: Infinity is a known (unbounded) duration, not a missing one.
    [{ playerDurationSec: 0, hintDurationSec: Number.POSITIVE_INFINITY }, true],
  ])("%p -> %p", (input, expected) => {
    expect(isNativeDurationReady(input)).toBe(expected)
  })
})

describe("hasPlayheadMovedToward", () => {
  test("requires the gap to shrink by epsilon", () => {
    expect(
      hasPlayheadMovedToward({ fromSec: 0, currentSec: 0, targetSec: 19 }),
    ).toBe(false)
    expect(
      hasPlayheadMovedToward({ fromSec: 0, currentSec: 10, targetSec: 19 }),
    ).toBe(true)
    expect(
      hasPlayheadMovedToward({ fromSec: 19, currentSec: 0, targetSec: 19 }),
    ).toBe(false)
  })
})

describe("native seek tracker", () => {
  const base = {
    anchorMs: 19_000,
    thresholdSec: 0.8,
    roomPaused: true,
  }

  test("same-tick echo of the target cannot confirm", () => {
    const t = createNativeSyncTracker()
    t.noteSeek({ anchorMs: 19_000, fromSec: 0, targetSec: 19, nowMs: 1_000 })
    expect(
      t.evaluateSeek({ ...base, currentSec: 19, driftSec: 0, nowMs: 1_000 }),
    ).toBe("pending")
    expect(
      t.evaluateSeek({ ...base, currentSec: 19, driftSec: 0, nowMs: 1_300 }),
    ).toBe("confirmed")
    expect(t.hasSeekProbe()).toBe(false)
  })

  test("stale playhead stays pending, then gives up after N failures", () => {
    const t = createNativeSyncTracker()
    t.noteSeek({ anchorMs: 19_000, fromSec: 0, targetSec: 19, nowMs: 0 })
    for (let i = 1; i < NATIVE_MAX_VERIFY_FAILURES; i++) {
      expect(
        t.evaluateSeek({
          ...base,
          currentSec: 0,
          driftSec: 19,
          nowMs: i * 500,
        }),
      ).toBe("pending")
    }
    expect(
      t.evaluateSeek({
        ...base,
        currentSec: 0,
        driftSec: 19,
        nowMs: 10_000,
      }),
    ).toBe("gave-up")
    expect(t.hasSeekProbe()).toBe(false)
  })

  test("playing room: frozen playhead inside threshold is stale, not confirmed", () => {
    const t = createNativeSyncTracker()
    // Tiny seek: baseline already ~target so "moved toward" is false.
    t.noteSeek({ anchorMs: 5_000, fromSec: 5.1, targetSec: 5, nowMs: 0 })
    const input = {
      anchorMs: 5_000,
      thresholdSec: 0.8,
      roomPaused: false,
    }
    // First post-write read compares against the baseline (5.1) -> stale.
    expect(
      t.evaluateSeek({ ...input, currentSec: 5.1, driftSec: 0.1, nowMs: 300 }),
    ).toBe("pending")
    // Playhead advances -> confirmed.
    expect(
      t.evaluateSeek({ ...input, currentSec: 5.8, driftSec: 0.1, nowMs: 700 }),
    ).toBe("confirmed")
  })

  test("a newer anchor supersedes the probe", () => {
    const t = createNativeSyncTracker()
    t.noteSeek({ anchorMs: 1_000, fromSec: 0, targetSec: 1, nowMs: 0 })
    expect(
      t.evaluateSeek({
        ...base,
        anchorMs: 2_000,
        currentSec: 0,
        driftSec: 2,
        nowMs: 500,
      }),
    ).toBe("none")
  })
})

describe("native pause quiescence", () => {
  const sample = (
    t: ReturnType<typeof createNativeSyncTracker>,
    sec: number,
    nowMs: number,
    wrapperPaused = true,
  ) => t.samplePauseQuiescence({ currentSec: sec, wrapperPaused, nowMs })

  test("needs two agreeing samples; advancing playhead resets", () => {
    const t = createNativeSyncTracker()
    expect(sample(t, 10, 0).quiescent).toBe(false)
    // Too close to judge.
    expect(sample(t, 10, 50)).toEqual({ quiescent: false, sampled: false })
    // Wrapper says paused, but playhead advanced 2s -> lying.
    expect(sample(t, 12, 400)).toEqual({ quiescent: false, sampled: true })
    expect(sample(t, 14, 800).quiescent).toBe(false)
    expect(sample(t, 14, 1_200).quiescent).toBe(true)
  })

  test("wrapper paused=false is never quiescent", () => {
    const t = createNativeSyncTracker()
    sample(t, 10, 0, false)
    expect(sample(t, 10, 400, false).quiescent).toBe(false)
  })

  test("a seek write restarts sampling", () => {
    const t = createNativeSyncTracker()
    sample(t, 0, 0)
    t.noteSeek({ anchorMs: 19_000, fromSec: 0, targetSec: 19, nowMs: 100 })
    // Jump to 19 must not read as "still playing".
    expect(sample(t, 19, 500)).toEqual({ quiescent: false, sampled: true })
    expect(sample(t, 19, 900).quiescent).toBe(true)
  })

  test("pause seek is claimed once per key", () => {
    const t = createNativeSyncTracker()
    expect(t.claimPauseSeek("a")).toBe(true)
    expect(t.claimPauseSeek("a")).toBe(false)
    expect(t.claimPauseSeek("b")).toBe(true)
  })
})
