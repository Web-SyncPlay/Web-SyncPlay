import { describe, expect, test } from "bun:test"

import {
  AUDIO_DELAY_MAX_MS,
  AUDIO_DELAY_MIN_MS,
  clampAudioDelayMs,
  formatAudioDelayLabel,
} from "./audio-delay"

describe("clampAudioDelayMs", () => {
  test("keeps values inside the local offset range", () => {
    expect(clampAudioDelayMs(214)).toBe(214)
    expect(clampAudioDelayMs(-214)).toBe(-214)
    expect(clampAudioDelayMs(0)).toBe(0)
  })

  test("clamps to the configured bounds", () => {
    expect(clampAudioDelayMs(AUDIO_DELAY_MAX_MS + 500)).toBe(AUDIO_DELAY_MAX_MS)
    expect(clampAudioDelayMs(AUDIO_DELAY_MIN_MS - 500)).toBe(AUDIO_DELAY_MIN_MS)
  })

  test("falls back for non-finite input", () => {
    expect(clampAudioDelayMs(Number.NaN)).toBe(0)
    expect(clampAudioDelayMs(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe("formatAudioDelayLabel", () => {
  test("formats signed millisecond labels", () => {
    expect(formatAudioDelayLabel(214)).toBe("+214 ms")
    expect(formatAudioDelayLabel(-214)).toBe("-214 ms")
    expect(formatAudioDelayLabel(0)).toBe("0 ms")
  })
})
