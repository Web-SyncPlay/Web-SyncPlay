import { expect, test } from "bun:test"
import type { RoomState } from "@/zod/types"
import { projectPlaybackMs } from "./use-playback-timeline-controller"

test("projectPlaybackMs advances time when playback is active", () => {
  const baseNow = 100_000
  const roomState = {
    playback: {
      paused: false,
      playbackRate: 1.5,
      timelineAnchorMs: 20_000,
      serverNowMs: baseNow,
      videoLoop: "off",
      playlistLoop: "off",
      shuffle: false,
    },
  } as RoomState

  const projected = projectPlaybackMs(roomState, baseNow + 4_000)
  expect(projected).toBe(26_000)
})

test("projectPlaybackMs keeps anchor when paused", () => {
  const baseNow = 100_000
  const roomState = {
    playback: {
      paused: true,
      playbackRate: 2,
      timelineAnchorMs: 30_000,
      serverNowMs: baseNow,
      videoLoop: "off",
      playlistLoop: "off",
      shuffle: false,
    },
  } as RoomState

  const projected = projectPlaybackMs(roomState, baseNow + 10_000)
  expect(projected).toBe(30_000)
})
