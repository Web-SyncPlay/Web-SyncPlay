import { describe, expect, test } from "bun:test"
import {
  applyPlaybackClockToPlayer,
  applyPlaybackSyncToPlayer,
  nudgePlaybackTransport,
} from "./apply-playback-sync"
import { DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC } from "./playback-sync"

describe("applyPlaybackClockToPlayer", () => {
  test("seeks and sets rate without touching transport", () => {
    const order: string[] = []
    let currentTime = 0
    const player = {
      playbackRate: 1,
      get currentTime() {
        return currentTime
      },
      set currentTime(value: number) {
        currentTime = value
        order.push(`seek:${value}`)
      },
      pause() {
        order.push("pause")
      },
      play() {
        order.push("play")
      },
    }

    applyPlaybackClockToPlayer({
      player,
      syncState: {
        paused: false,
        playbackRate: 1.5,
        timelineAnchorMs: 5_000,
        serverNowMs: 100,
      },
      nowMs: 100,
      driftThresholdSec: DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
    })

    expect(order).toEqual(["seek:5"])
    expect(player.playbackRate).toBe(1.5)
  })

  test("skips seek when within drift threshold", () => {
    const order: string[] = []
    let currentTime = 1.2
    const player = {
      playbackRate: 1,
      get currentTime() {
        return currentTime
      },
      set currentTime(value: number) {
        currentTime = value
        order.push(`seek:${value}`)
      },
    }

    applyPlaybackClockToPlayer({
      player,
      syncState: {
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 1_000,
        serverNowMs: 1_000,
      },
      nowMs: 1_000,
      driftThresholdSec: DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
    })

    expect(order).toEqual([])
  })

  test("clamps seek to just before duration when clock is past EOF", () => {
    const order: string[] = []
    let currentTime = 0
    const player = {
      playbackRate: 1,
      duration: 10,
      get currentTime() {
        return currentTime
      },
      set currentTime(value: number) {
        currentTime = value
        order.push(`seek:${value}`)
      },
    }

    applyPlaybackClockToPlayer({
      player,
      syncState: {
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 12_000,
        serverNowMs: 100,
      },
      nowMs: 100,
      driftThresholdSec: DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
    })

    expect(order).toEqual(["seek:9.95"])
  })

  test("prefers seekableEnd over a lagging duration for live/DVR", () => {
    const order: string[] = []
    let currentTime = 40
    const mediaEl = {
      currentTime: 40,
    }
    const player = {
      playbackRate: 1,
      duration: 40,
      seekableEnd: 52,
      mediaEl,
      get currentTime() {
        return currentTime
      },
      set currentTime(value: number) {
        currentTime = value
        order.push(`seek:${value}`)
      },
    }

    applyPlaybackClockToPlayer({
      player,
      syncState: {
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 50_000,
        serverNowMs: 100,
      },
      nowMs: 100,
      driftThresholdSec: DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
    })

    expect(order).toEqual(["seek:50"])
    expect(mediaEl.currentTime).toBe(50)
  })
})

describe("nudgePlaybackTransport", () => {
  test("plays only when local is paused and room wants play", () => {
    const order: string[] = []
    const player = {
      paused: true,
      pause() {
        order.push("pause")
        this.paused = true
      },
      play() {
        order.push("play")
        this.paused = false
      },
    }

    nudgePlaybackTransport({ player, paused: false })
    expect(order).toEqual(["play"])

    order.length = 0
    nudgePlaybackTransport({ player, paused: false })
    expect(order).toEqual([])
  })

  test("pauses when room wants pause", () => {
    const order: string[] = []
    const player = {
      paused: false,
      pause() {
        order.push("pause")
        this.paused = true
      },
      play() {
        order.push("play")
        this.paused = false
      },
    }

    nudgePlaybackTransport({ player, paused: true })
    expect(order).toEqual(["pause"])
  })
})

describe("applyPlaybackSyncToPlayer", () => {
  test("full mode seeks before playing", () => {
    const order: string[] = []
    let currentTime = 0
    const player = {
      playbackRate: 1,
      paused: true,
      get currentTime() {
        return currentTime
      },
      set currentTime(value: number) {
        currentTime = value
        order.push(`seek:${value}`)
      },
      pause() {
        order.push("pause")
      },
      play() {
        order.push("play")
        this.paused = false
      },
    }

    applyPlaybackSyncToPlayer({
      player,
      syncState: {
        paused: false,
        playbackRate: 1.5,
        timelineAnchorMs: 5_000,
        serverNowMs: 100,
      },
      nowMs: 100,
      mode: "full",
    })

    expect(order).toEqual(["seek:5", "play"])
    expect(player.playbackRate).toBe(1.5)
  })

  test("clock mode never plays or pauses", () => {
    const order: string[] = []
    const player = {
      playbackRate: 1,
      currentTime: 0,
      paused: true,
      pause() {
        order.push("pause")
      },
      play() {
        order.push("play")
      },
    }

    const result = applyPlaybackSyncToPlayer({
      player,
      syncState: {
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 0,
        serverNowMs: Date.now(),
      },
      mode: "clock",
    })

    expect(order).toEqual([])
    expect(result.playAttempt).toBeNull()
  })
})
