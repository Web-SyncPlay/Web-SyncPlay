import {
  AUDIO_DELAY_MAX_MS,
  AUDIO_DELAY_MIN_MS,
  AUDIO_DELAY_STORAGE_KEY,
  DEFAULT_AUDIO_DELAY_MS,
  clampAudioDelayMs,
} from "@/shared/audio-delay"
import { readClampedNumberFromStorage } from "@/shared/dom/storage-utils"

export function readAudioDelayMsFromStorage(): number {
  return readClampedNumberFromStorage(AUDIO_DELAY_STORAGE_KEY, {
    min: AUDIO_DELAY_MIN_MS,
    max: AUDIO_DELAY_MAX_MS,
    fallback: DEFAULT_AUDIO_DELAY_MS,
  })
}

export function persistAudioDelayMs(delayMs: number): number {
  const next = clampAudioDelayMs(delayMs)
  if (typeof window !== "undefined") {
    window.localStorage.setItem(AUDIO_DELAY_STORAGE_KEY, String(next))
  }
  return next
}
