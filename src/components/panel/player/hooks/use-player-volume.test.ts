import { describe, expect, test } from "bun:test"

import {
  DEFAULT_PLAYER_VOLUME,
  isVolumeSettling,
  markVolumeSettling,
  resolveUnmuteVolume,
  shouldPersistVolumeChange,
  VOLUME_SETTLING_MS,
} from "./use-player-volume"

describe("resolveUnmuteVolume", () => {
  test("keeps a stored preference above silence", () => {
    expect(resolveUnmuteVolume(0.4)).toBe(0.4)
    expect(resolveUnmuteVolume(0.75)).toBe(0.75)
    expect(resolveUnmuteVolume(1)).toBe(1)
  })

  test("falls back to 40% when preferred volume is silent", () => {
    expect(resolveUnmuteVolume(0)).toBe(DEFAULT_PLAYER_VOLUME)
    expect(resolveUnmuteVolume(0.01)).toBe(DEFAULT_PLAYER_VOLUME)
    expect(resolveUnmuteVolume(0.005)).toBe(DEFAULT_PLAYER_VOLUME)
  })
})

describe("shouldPersistVolumeChange", () => {
  test("persists mid-range volume changes", () => {
    expect(
      shouldPersistVolumeChange({
        nextVolume: 0.55,
        nextMuted: false,
        preferredVolume: 0.4,
        mediaReady: true,
      }),
    ).toBe(true)
  })

  test("ignores mute-side-effect extremes that diverge from preference", () => {
    expect(
      shouldPersistVolumeChange({
        nextVolume: 1,
        nextMuted: true,
        preferredVolume: 0.4,
        mediaReady: true,
      }),
    ).toBe(false)
    expect(
      shouldPersistVolumeChange({
        nextVolume: 0,
        nextMuted: true,
        preferredVolume: 0.4,
        mediaReady: true,
      }),
    ).toBe(false)
  })

  test("ignores pre-canplay provider default volume=1 while unmuted", () => {
    expect(
      shouldPersistVolumeChange({
        nextVolume: 1,
        nextMuted: false,
        preferredVolume: 0.4,
        mediaReady: false,
      }),
    ).toBe(false)
  })

  test("allows intentional 100% after media is ready and settled", () => {
    expect(
      shouldPersistVolumeChange({
        nextVolume: 1,
        nextMuted: false,
        preferredVolume: 0.4,
        mediaReady: true,
        volumeSettling: false,
      }),
    ).toBe(true)
  })

  test("ignores provider volume=1 during post-canplay settling", () => {
    expect(
      shouldPersistVolumeChange({
        nextVolume: 1,
        nextMuted: false,
        preferredVolume: 0.4,
        mediaReady: true,
        volumeSettling: true,
      }),
    ).toBe(false)
  })

  test("persists extremes that already match preference", () => {
    expect(
      shouldPersistVolumeChange({
        nextVolume: 1,
        nextMuted: false,
        preferredVolume: 1,
        mediaReady: false,
      }),
    ).toBe(true)
  })
})

describe("volume settling window", () => {
  test("markVolumeSettling arms a short post-canplay window", () => {
    const readyRef = { current: true }
    const now = Date.now()
    markVolumeSettling(readyRef, VOLUME_SETTLING_MS)
    expect(isVolumeSettling(readyRef, now + 10)).toBe(true)
    expect(isVolumeSettling(readyRef, now + VOLUME_SETTLING_MS + 1)).toBe(false)
  })
})
