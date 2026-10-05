import { describe, expect, test } from "bun:test"
import { applyPlaybackSyncToPlayer } from "./apply-playback-sync"

describe("applyPlaybackSyncToPlayer", () => {
  test("seeks before playing when drift exceeds threshold", () => {
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

    applyPlaybackSyncToPlayer({
      player,
      syncState: {
        paused: false,
        playbackRate: 1.5,
        timelineAnchorMs: 5_000,
        serverNowMs: 100,
      },
      nowMs: 100,
      driftThresholdSec: 0.8,
    })

    expect(order).toEqual(["seek:5", "play"])
    expect(player.playbackRate).toBe(1.5)
    expect(currentTime).toBe(5)
  })

  test("pauses without attempting play", () => {
    const order: string[] = []
    const player = {
      playbackRate: 1,
      currentTime: 3,
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
        paused: true,
        playbackRate: 1,
        timelineAnchorMs: 3_000,
        serverNowMs: Date.now(),
      },
    })

    expect(order).toEqual(["pause"])
    expect(result.playAttempt).toBeNull()
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
      pause() {
        order.push("pause")
      },
      play() {
        order.push("play")
      },
    }

    applyPlaybackSyncToPlayer({
      player,
      syncState: {
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 1_000,
        serverNowMs: 1_000,
      },
      nowMs: 1_000,
      driftThresholdSec: 0.8,
    })

    expect(order).toEqual(["play"])
  })
})
