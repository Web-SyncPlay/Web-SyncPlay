import { describe, expect, test } from "bun:test"
import {
  readMediaSeekableEndSec,
  readPlayerPlayheadSec,
  readPlayerSeekableEndSec,
} from "./player-utils"

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
