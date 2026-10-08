import { clampNumber, readClampedNumberFromStorage } from "@/lib/storage-utils"

/** Local-only audio delay range (ms). Positive delays audio; negative advances it. */
export const AUDIO_DELAY_MIN_MS = -2000
export const AUDIO_DELAY_MAX_MS = 2000
export const AUDIO_DELAY_STORAGE_KEY = "web-syncplay:audio-delay-ms"
export const DEFAULT_AUDIO_DELAY_MS = 0

export function clampAudioDelayMs(value: number): number {
  return clampNumber(
    value,
    AUDIO_DELAY_MIN_MS,
    AUDIO_DELAY_MAX_MS,
    DEFAULT_AUDIO_DELAY_MS,
  )
}

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

export function formatAudioDelayLabel(delayMs: number): string {
  const clamped = clampAudioDelayMs(delayMs)
  if (clamped > 0) return `+${clamped} ms`
  return `${clamped} ms`
}
