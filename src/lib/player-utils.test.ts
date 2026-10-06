import { describe, expect, test } from "bun:test"
import {
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
