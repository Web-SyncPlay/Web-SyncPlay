import { describe, expect, test } from "bun:test"
import {
  extrapolateLocalPlaybackTimeMs,
  shouldExtrapolateLocalPlayback,
} from "./local-playback-display"

describe("extrapolateLocalPlaybackTimeMs", () => {
  const base = {
    paused: false,
    loading: false,
    currentTimeMs: 10_000,
    updatedAt: 1_000_000,
  }

  test("advances playing ready samples by wall-clock age", () => {
    expect(extrapolateLocalPlaybackTimeMs(base, 1_003_000)).toBe(13_000)
  })

  test("applies playback rate", () => {
    expect(
      extrapolateLocalPlaybackTimeMs(base, 1_002_000, { playbackRate: 1.5 }),
    ).toBe(13_000)
  })

  test("does not advance when paused", () => {
    expect(
      extrapolateLocalPlaybackTimeMs({ ...base, paused: true }, 1_005_000),
    ).toBe(10_000)
  })

  test("does not advance when loading", () => {
    expect(
      extrapolateLocalPlaybackTimeMs({ ...base, loading: true }, 1_005_000),
    ).toBe(10_000)
  })

  test("does not advance when errored", () => {
    expect(
      extrapolateLocalPlaybackTimeMs(
        { ...base, error: "decode failed" },
        1_005_000,
      ),
    ).toBe(10_000)
  })

  test("caps at duration when provided", () => {
    expect(
      extrapolateLocalPlaybackTimeMs(base, 1_020_000, {
        durationMs: 12_000,
      }),
    ).toBe(12_000)
  })

  test("never goes below zero", () => {
    expect(
      extrapolateLocalPlaybackTimeMs({ ...base, currentTimeMs: -50 }, 999_000),
    ).toBe(0)
  })
})

describe("shouldExtrapolateLocalPlayback", () => {
  test("true only while playing and ready", () => {
    expect(
      shouldExtrapolateLocalPlayback({
        paused: false,
        loading: false,
      }),
    ).toBe(true)
    expect(
      shouldExtrapolateLocalPlayback({
        paused: true,
        loading: false,
      }),
    ).toBe(false)
    expect(
      shouldExtrapolateLocalPlayback({
        paused: false,
        loading: true,
      }),
    ).toBe(false)
    expect(
      shouldExtrapolateLocalPlayback({
        paused: false,
        loading: false,
        error: "x",
      }),
    ).toBe(false)
  })
})
