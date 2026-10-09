import { describe, expect, test } from "bun:test"
import { planPlaybackDriftCorrection } from "./use-playback-drift-correction"
import type { PendingSyncState } from "./use-buffering-watchdog"

const playback = {
  paused: false,
  playbackRate: 1,
  timelineAnchorMs: 9_000,
  serverNowMs: 1_000,
  videoLoop: "off" as const,
}

const pending: PendingSyncState = {
  paused: false,
  playbackRate: 1,
  timelineAnchorMs: 1_000,
  serverNowMs: 1_000,
  videoLoop: false,
}

describe("planPlaybackDriftCorrection", () => {
  test("prefers pending syncState for measure/apply pairing", () => {
    const plan = planPlaybackDriftCorrection({
      pending,
      playback,
      driftSec: 2,
      thresholdSec: 0.35,
    })
    expect(plan.action).toBe("apply")
    expect(plan.syncState).toBe(pending)
    expect(plan.syncState.timelineAnchorMs).toBe(1_000)
  })

  test("falls back to playback snapshot when pending is null", () => {
    const plan = planPlaybackDriftCorrection({
      pending: null,
      playback,
      driftSec: 2,
      thresholdSec: 0.35,
    })
    expect(plan.action).toBe("apply")
    expect(plan.syncState.timelineAnchorMs).toBe(9_000)
  })

  test("clears when drift is within threshold using the same syncState", () => {
    const plan = planPlaybackDriftCorrection({
      pending,
      playback,
      driftSec: 0.1,
      thresholdSec: 0.35,
    })
    expect(plan.action).toBe("clear")
    expect(plan.syncState).toBe(pending)
  })

  test("no-ops when drift cannot be measured", () => {
    const plan = planPlaybackDriftCorrection({
      pending,
      playback,
      driftSec: null,
    })
    expect(plan.action).toBe("noop")
    expect(plan.syncState).toBe(pending)
  })
})
