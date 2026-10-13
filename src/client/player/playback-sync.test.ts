import { describe, expect, test } from "bun:test"
import {
  CATCH_UP_RATE_MAX_FACTOR,
  CATCH_UP_RATE_MIN_FACTOR,
  DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
  FORCE_SEEK_LEAD_SEC,
  computeExpectedPlaybackTimeSec,
  measurePlaybackDriftSec,
  resolveCatchUpPlaybackRate,
  resolvePlaybackDriftThresholdSec,
  resolveSeekCeilingSec,
} from "./playback-sync"

describe("resolvePlaybackDriftThresholdSec", () => {
  test("floors at the default soft threshold", () => {
    expect(resolvePlaybackDriftThresholdSec(0)).toBe(
      DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
    )
    expect(resolvePlaybackDriftThresholdSec(100)).toBe(
      DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
    )
  })

  test("grows with half-RTT once latency exceeds the floor", () => {
    // halfRtt 0.6s + 0.25 = 0.85 > 0.8
    expect(resolvePlaybackDriftThresholdSec(1_200)).toBeCloseTo(0.85, 5)
    // halfRtt 1s + 0.25 = 1.25
    expect(resolvePlaybackDriftThresholdSec(2_000)).toBeCloseTo(1.25, 5)
  })

  test("FORCE_SEEK_LEAD_SEC is disabled", () => {
    expect(FORCE_SEEK_LEAD_SEC).toBe(0)
  })
})

describe("resolveSeekCeilingSec", () => {
  test("uses the larger of duration and seekableEnd (VOD buffer < duration)", () => {
    // HLS/progressive often expose only the buffered window as seekable.
    expect(
      resolveSeekCeilingSec({ durationSec: 120, seekableEndSec: 15 }),
    ).toBeCloseTo(119.95, 5)
  })

  test("uses seekableEnd when it extends past a lagging live duration", () => {
    expect(
      resolveSeekCeilingSec({ durationSec: 40, seekableEndSec: 52 }),
    ).toBeCloseTo(51.95, 5)
  })

  test("false-live Infinity duration does not clamp to buffered seekable", () => {
    // Provider reports Infinity (no ENDLIST) but catalog is VOD — seeking to
    // the room anchor must write 20s, not clamp to buffered ~5s.
    expect(
      resolveSeekCeilingSec({
        durationSec: Number.POSITIVE_INFINITY,
        seekableEndSec: 5.2,
      }),
    ).toBeNull()
    expect(
      resolveSeekCeilingSec({
        durationSec: Number.POSITIVE_INFINITY,
        seekableEndSec: 5.2,
        durationHintSec: 180,
      }),
    ).toBeCloseTo(179.95, 5)
  })

  test("duration ≈ seekable is buffer-only even when a long hint exists", () => {
    // Existing HLS sessions often report duration==seekableEnd≈5 while the
    // room seeks to 20; clamping here froze host/guest while late joiners worked.
    expect(
      resolveSeekCeilingSec({ durationSec: 5.05, seekableEndSec: 5.01 }),
    ).toBeNull()
    expect(
      resolveSeekCeilingSec({
        durationSec: 5.05,
        seekableEndSec: 5.01,
        durationHintSec: 600,
      }),
    ).toBeCloseTo(599.95, 5)
  })

  test("hint ≈ seekable is treated as poisoned and ignored", () => {
    expect(
      resolveSeekCeilingSec({
        durationSec: 5.05,
        seekableEndSec: 5.01,
        durationHintSec: 5,
      }),
    ).toBeNull()
  })

  test("catalog live uses seekableEnd as the DVR ceiling", () => {
    expect(
      resolveSeekCeilingSec({
        durationSec: Number.POSITIVE_INFINITY,
        seekableEndSec: 52,
        isLive: true,
      }),
    ).toBeCloseTo(51.95, 5)
  })

  test("returns null for seekable-only unknown VOD (do not clamp authority)", () => {
    expect(resolveSeekCeilingSec({ seekableEndSec: 5.2 })).toBeNull()
    expect(resolveSeekCeilingSec({})).toBeNull()
  })

  test("falls back to finite duration or hint", () => {
    expect(resolveSeekCeilingSec({ durationSec: 30 })).toBeCloseTo(29.95, 5)
    expect(
      resolveSeekCeilingSec({ durationHintSec: 90, seekableEndSec: 12 }),
    ).toBeCloseTo(89.95, 5)
  })

  test("fully seekable long VOD (duration === seekable) stays trusted", () => {
    // Progressive MP4 often reports duration==seekableEnd once buffered;
    // that must not be treated as an HLS buffer blip.
    expect(
      resolveSeekCeilingSec({ durationSec: 180, seekableEndSec: 180 }),
    ).toBeCloseTo(179.95, 5)
  })
})

describe("measurePlaybackDriftSec", () => {
  test("buffer-as-duration does not falsely converge at ~5s vs room 20s", () => {
    // Existing HLS sessions: duration≈seekable≈5 while room anchor is 20.
    // Clamping expectedSec to that window made drift look ~0 and stopped retries.
    const drift = measurePlaybackDriftSec(
      5.01,
      {
        paused: true,
        playbackRate: 1,
        timelineAnchorMs: 20_000,
        serverNowMs: 1_000,
      },
      1_000,
      5.05,
      5.01,
    )
    expect(drift).toBeCloseTo(14.99, 2)
  })

  test("poisoned hint≈seekable still reports unclamped drift", () => {
    const drift = measurePlaybackDriftSec(
      5.01,
      {
        paused: true,
        playbackRate: 1,
        timelineAnchorMs: 20_000,
        serverNowMs: 1_000,
      },
      1_000,
      5.05,
      5.01,
      5,
    )
    expect(drift).toBeCloseTo(14.99, 2)
  })

  test("trusted EOF ceiling converges when room is past media end", () => {
    const drift = measurePlaybackDriftSec(
      9.95,
      {
        paused: true,
        playbackRate: 1,
        timelineAnchorMs: 12_000,
        serverNowMs: 1_000,
      },
      1_000,
      10,
    )
    expect(drift).toBeLessThanOrEqual(0.8)
  })

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

describe("resolveCatchUpPlaybackRate", () => {
  test("drift 1.5 → rate in [1.05, 1.5] at room rate 1", () => {
    const rate = resolveCatchUpPlaybackRate(1, 1.5)
    expect(rate).not.toBeNull()
    expect(rate!).toBeCloseTo(1.4, 5)
    expect(rate!).toBeGreaterThanOrEqual(CATCH_UP_RATE_MIN_FACTOR)
    expect(rate!).toBeLessThanOrEqual(CATCH_UP_RATE_MAX_FACTOR)
  })

  test("drift 0.5 → no catch-up (below band)", () => {
    expect(resolveCatchUpPlaybackRate(1, 0.5)).toBeNull()
  })

  test("drift 2.5 → catch-up (mid-range lag within band)", () => {
    const rate = resolveCatchUpPlaybackRate(1, 2.5)
    expect(rate).not.toBeNull()
    expect(rate!).toBeCloseTo(1.4, 5)
  })

  test("drift 4 → no catch-up (seek path past max band)", () => {
    expect(resolveCatchUpPlaybackRate(1, 4)).toBeNull()
  })

  test("scales from a non-1 room rate", () => {
    const rate = resolveCatchUpPlaybackRate(2, 1.5)
    expect(rate).toBeCloseTo(2.8, 5)
  })
})
