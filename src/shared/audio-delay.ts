import { clampNumber } from "@/shared/number-utils"

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

export function formatAudioDelayLabel(delayMs: number): string {
  const clamped = clampAudioDelayMs(delayMs)
  if (clamped > 0) return `+${clamped} ms`
  return `${clamped} ms`
}
