import { afterEach, describe, expect, test } from "bun:test"

import {
  AUDIO_DELAY_MAX_MS,
  AUDIO_DELAY_MIN_MS,
  AUDIO_DELAY_STORAGE_KEY,
  clampAudioDelayMs,
  formatAudioDelayLabel,
  persistAudioDelayMs,
  readAudioDelayMsFromStorage,
} from "./audio-delay"

function installLocalStorage() {
  const storage = new Map<string, string>()
  ;(globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value)
      },
      removeItem: (key: string) => {
        storage.delete(key)
      },
      clear: () => {
        storage.clear()
      },
    },
  }
  return storage
}

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

describe("audio delay storage", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  test("persists and reloads a signed offset", () => {
    const storage = installLocalStorage()
    expect(persistAudioDelayMs(-214)).toBe(-214)
    expect(storage.get(AUDIO_DELAY_STORAGE_KEY)).toBe("-214")
    expect(readAudioDelayMsFromStorage()).toBe(-214)
  })

  test("clamps on persist and rejects garbage on read", () => {
    const storage = installLocalStorage()
    expect(persistAudioDelayMs(9_999)).toBe(AUDIO_DELAY_MAX_MS)
    storage.set(AUDIO_DELAY_STORAGE_KEY, "not-a-number")
    expect(readAudioDelayMsFromStorage()).toBe(0)
  })

  test("returns default when window is missing", () => {
    delete (globalThis as { window?: unknown }).window
    expect(readAudioDelayMsFromStorage()).toBe(0)
  })
})
