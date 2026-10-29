import { describe, expect, test } from "bun:test"

import { resolvePresenceLoading } from "./presence-loading"

describe("resolvePresenceLoading", () => {
  test("true while buffering regardless of visibility", () => {
    expect(
      resolvePresenceLoading({
        hidden: false,
        isMediaReady: true,
        isBuffering: true,
        roomPaused: false,
        currentTimeMs: 5_000,
      }),
    ).toBe(true)
  })

  test("true while hidden and not ready after playlist remount", () => {
    expect(
      resolvePresenceLoading({
        hidden: true,
        isMediaReady: false,
        isBuffering: false,
        roomPaused: false,
        currentTimeMs: 0,
      }),
    ).toBe(true)
  })

  test("true while hidden and not ready near 0:00 (stuck-at-start case)", () => {
    expect(
      resolvePresenceLoading({
        hidden: true,
        isMediaReady: false,
        isBuffering: false,
        roomPaused: false,
        currentTimeMs: 749,
      }),
    ).toBe(true)
  })

  test("false when visible, ready, and not buffering", () => {
    expect(
      resolvePresenceLoading({
        hidden: false,
        isMediaReady: true,
        isBuffering: false,
        roomPaused: false,
        currentTimeMs: 12_000,
      }),
    ).toBe(false)
  })

  test("false when hidden but ready and playing past start", () => {
    expect(
      resolvePresenceLoading({
        hidden: true,
        isMediaReady: true,
        isBuffering: false,
        roomPaused: false,
        currentTimeMs: 5_000,
      }),
    ).toBe(false)
  })
})
