import { describe, expect, test } from "bun:test"
import {
  canPlayNatively,
  resolveLiveEdgeSec,
  resolvePlayerDurationSec,
  resolvePlayerStreamType,
} from "./player-utils"

describe("canPlayNatively", () => {
  test("treats common progressive and adaptive media as native", () => {
    expect(canPlayNatively("https://cdn.example/a.mp4")).toBe(true)
    expect(canPlayNatively("https://cdn.example/a.m3u8?token=1")).toBe(true)
    expect(canPlayNatively("https://cdn.example/a.webm")).toBe(true)
  })

  test("does not treat progressive MPEG-TS as browser-native", () => {
    expect(canPlayNatively("https://cdn.example/a.ts")).toBe(false)
    expect(canPlayNatively("https://cdn.example/a.m2ts")).toBe(false)
  })
})

describe("resolvePlayerStreamType", () => {
  test("forces on-demand for VOD and unknown items", () => {
    expect(resolvePlayerStreamType(undefined)).toBe("on-demand")
    expect(resolvePlayerStreamType({ isLive: false })).toBe("on-demand")
    expect(resolvePlayerStreamType({})).toBe("on-demand")
  })

  test("keeps live only when explicitly marked", () => {
    expect(resolvePlayerStreamType({ isLive: true })).toBe("live")
  })
})

describe("resolvePlayerDurationSec", () => {
  test("returns catalog duration for VOD", () => {
    expect(
      resolvePlayerDurationSec({ isLive: false, durationSeconds: 3721 }),
    ).toBe(3721)
  })

  test("omits duration for live or missing values", () => {
    expect(
      resolvePlayerDurationSec({ isLive: true, durationSeconds: 100 }),
    ).toBeUndefined()
    expect(resolvePlayerDurationSec({ durationSeconds: 0 })).toBeUndefined()
    expect(resolvePlayerDurationSec({})).toBeUndefined()
  })
})

describe("resolveLiveEdgeSec", () => {
  test("uses seekableEnd minus 2 seconds", () => {
    expect(resolveLiveEdgeSec({ seekableEnd: 120 })).toBe(118)
  })

  test("prefers seekableEnd over a stale liveSyncPosition", () => {
    expect(
      resolveLiveEdgeSec({ seekableEnd: 120, liveSyncPosition: 100 }),
    ).toBe(118)
  })

  test("clamps liveSyncPosition that is ahead of seekableEnd", () => {
    expect(
      resolveLiveEdgeSec({ seekableEnd: 120, liveSyncPosition: 130 }),
    ).toBe(118)
  })

  test("falls back to liveSyncPosition when seekableEnd is unusable", () => {
    expect(
      resolveLiveEdgeSec({ seekableEnd: Infinity, liveSyncPosition: 90 }),
    ).toBe(90)
  })

  test("returns null without a usable edge", () => {
    expect(resolveLiveEdgeSec({})).toBeNull()
    expect(resolveLiveEdgeSec({ seekableEnd: Infinity })).toBeNull()
  })
})
