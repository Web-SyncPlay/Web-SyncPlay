import { describe, expect, test } from "bun:test"
import { pendingSyncFromPlayback } from "./pending-sync"

describe("pendingSyncFromPlayback", () => {
  test("maps boolean videoLoop through unchanged", () => {
    expect(
      pendingSyncFromPlayback({
        paused: true,
        playbackRate: 1.25,
        timelineAnchorMs: 4_000,
        serverNowMs: 9_000,
        videoLoop: true,
      }),
    ).toEqual({
      paused: true,
      playbackRate: 1.25,
      timelineAnchorMs: 4_000,
      serverNowMs: 9_000,
      videoLoop: true,
    })
  })

  test("treats string videoLoop other than off as looping", () => {
    expect(
      pendingSyncFromPlayback({
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 0,
        serverNowMs: 1,
        videoLoop: "one",
      }).videoLoop,
    ).toBe(true)

    expect(
      pendingSyncFromPlayback({
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 0,
        serverNowMs: 1,
        videoLoop: "off",
      }).videoLoop,
    ).toBe(false)
  })
})
