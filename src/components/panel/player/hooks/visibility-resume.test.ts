import { describe, expect, test } from "bun:test"

import {
  planVisibilityResume,
  VISIBILITY_REMOUNT_GRACE_MS,
} from "./visibility-resume"

describe("planVisibilityResume", () => {
  test("applies room clock when media is already ready", () => {
    expect(planVisibilityResume({ isMediaReady: true })).toEqual({
      action: "apply-clock",
    })
  })

  test("buffers and schedules remount when media is not ready", () => {
    expect(planVisibilityResume({ isMediaReady: false })).toEqual({
      action: "buffer-and-schedule-remount",
      remountAfterMs: VISIBILITY_REMOUNT_GRACE_MS,
    })
  })
})
