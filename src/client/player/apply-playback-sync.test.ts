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

describe("real playhead (media element) measurement", () => {
  test("seeks when the wrapper claims sync but the element is behind", () => {
    const wrapperWrites: number[] = []
    const mediaEl = { currentTime: 2 }
    const player = {
      playbackRate: 1,
      duration: 120,
      mediaEl,
      // Wrapper currentTime lies (already at the target).
      get currentTime() {
        return 30
      },
      set currentTime(value: number) {
        wrapperWrites.push(value)
      },
    }

    const result = applyPlaybackClockToPlayer({
      player,
      syncState: {
        paused: true,
        playbackRate: 1,
        timelineAnchorMs: 30_000,
        serverNowMs: 100,
      },
      nowMs: 100,
    })

    expect(result.seekAttempted).toBe(true)
    expect(wrapperWrites).toEqual([30])
    expect(mediaEl.currentTime).toBe(30)
    expect(result.driftSec).toBe(0)
  })

  test("still writes the media element when the wrapper setter throws", () => {
    const mediaEl = { currentTime: 0 }
    const player = {
      playbackRate: 1,
      duration: 120,
      mediaEl,
      get currentTime() {
        return 0
      },
      set currentTime(_value: number) {
        throw new Error("wrapper not seekable")
      },
    }

    const result = applyPlaybackClockToPlayer({
      player,
      syncState: {
        paused: true,
        playbackRate: 1,
        timelineAnchorMs: 12_000,
        serverNowMs: 100,
      },
      nowMs: 100,
    })

    expect(result.seekAttempted).toBe(true)
    expect(mediaEl.currentTime).toBe(12)
  })

  test("threshold 0 force-seeks a sub-threshold late-join offset", () => {
    const mediaEl = { currentTime: 5.5 }
    const player = {
      playbackRate: 1,
      duration: 120,
      mediaEl,
      currentTime: 5.5,
    }
    const syncState = {
      paused: false,
      playbackRate: 1,
      timelineAnchorMs: 6_000,
      serverNowMs: 100,
    }

    applyPlaybackClockToPlayer({ player, syncState, nowMs: 100 })
    expect(mediaEl.currentTime).toBe(5.5)

    applyPlaybackClockToPlayer({
      player,
      syncState,
      nowMs: 100,
      driftThresholdSec: 0,
    })
    expect(mediaEl.currentTime).toBe(6)
    expect(player.currentTime).toBe(6)
  })
})

describe("nudgePlaybackTransport pause", () => {
  test("pauses a playing element and is idempotent once paused", () => {
    let pauseCalls = 0
    const player = {
      paused: false as boolean | undefined,
      pause() {
        pauseCalls += 1
        this.paused = true
      },
      play: () => {},
    }
    nudgePlaybackTransport({ player, paused: true })
    nudgePlaybackTransport({ player, paused: true })
    expect(pauseCalls).toBe(1)
    expect(player.paused).toBe(true)
  })
})
