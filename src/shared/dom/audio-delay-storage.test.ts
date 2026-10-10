import { afterEach, describe, expect, test } from "bun:test"

import {
  AUDIO_DELAY_MAX_MS,
  AUDIO_DELAY_STORAGE_KEY,
} from "@/shared/audio-delay"
import {
  persistAudioDelayMs,
  readAudioDelayMsFromStorage,
} from "./audio-delay-storage"

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
