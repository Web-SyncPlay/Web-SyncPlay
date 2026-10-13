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

describe("queryPlayerMediaElement", () => {
  test("finds media inside an open shadow root", async () => {
    const { queryPlayerMediaElement } = await import("./player-utils")
    if (typeof document === "undefined") {
      return
    }
    const host = document.createElement("div")
    const shadow = host.attachShadow({ mode: "open" })
    const video = document.createElement("video")
    shadow.appendChild(video)
    document.body.appendChild(host)
    try {
      expect(queryPlayerMediaElement(host)).toBe(video)
    } finally {
      host.remove()
    }
  })

  test("does not latch document media when an empty host is passed", async () => {
    const { queryPlayerMediaElement } = await import("./player-utils")
    if (typeof document === "undefined") {
      return
    }
    const orphan = document.createElement("video")
    document.body.appendChild(orphan)
    const emptyHost = document.createElement("div")
    document.body.appendChild(emptyHost)
    try {
      expect(queryPlayerMediaElement(emptyHost)).toBeNull()
      expect(queryPlayerMediaElement(null)).toBeNull()
      expect(queryPlayerMediaElement(undefined)).toBeNull()
    } finally {
      orphan.remove()
      emptyHost.remove()
    }
  })
})

describe("readPlayerSeekableEndSec", () => {
  test("uses player store seekableEnd when media is unavailable", () => {
    expect(readPlayerSeekableEndSec({ state: { seekableEnd: 88 } })).toBe(88)
  })

  test("returns undefined for non-finite store values", () => {
    expect(
      readPlayerSeekableEndSec({ state: { seekableEnd: Infinity } }),
    ).toBeUndefined()
  })
})
