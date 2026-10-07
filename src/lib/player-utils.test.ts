import { describe, expect, test } from "bun:test"
import {
  readMediaSeekableEndSec,
  readPlayerPlayheadSec,
  readPlayerSeekableEndSec,
  resolveLiveEdgeSec,
  resolvePlayerDurationSec,
  resolvePlayerStreamType,
} from "./player-utils"

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

describe("readMediaSeekableEndSec", () => {
  test("reads the last seekable range end", () => {
    const media = {
      seekable: {
        length: 1,
        start: () => 0,
        end: () => 42.5,
      },
    } as Pick<HTMLMediaElement, "seekable">
    expect(readMediaSeekableEndSec(media)).toBe(42.5)
  })

  test("returns null for empty or non-finite ranges", () => {
    expect(
      readMediaSeekableEndSec({
        seekable: { length: 0, start: () => 0, end: () => 0 },
      } as Pick<HTMLMediaElement, "seekable">),
    ).toBeNull()
    expect(
      readMediaSeekableEndSec({
        seekable: { length: 1, start: () => 0, end: () => Number.NaN },
      } as Pick<HTMLMediaElement, "seekable">),
    ).toBeNull()
  })
})

describe("readPlayerPlayheadSec", () => {
  test("falls back to player.currentTime without a media element", () => {
    expect(readPlayerPlayheadSec({ currentTime: 12.5 })).toBe(12.5)
  })
})

describe("readPlayerSeekableEndSec", () => {
  test("uses player store seekableEnd when media is unavailable", () => {
    expect(
      readPlayerSeekableEndSec({ state: { seekableEnd: 88 } }),
    ).toBe(88)
  })

  test("returns undefined for non-finite store values", () => {
    expect(
      readPlayerSeekableEndSec({ state: { seekableEnd: Infinity } }),
    ).toBeUndefined()
  })
})
