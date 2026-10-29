"use client"

import { useState } from "react"

import { readClampedNumberFromStorage } from "@/shared/dom/storage-utils"
import { clampNumber } from "@/shared/number-utils"

export const PLAYER_VOLUME_STORAGE_KEY = "web-syncplay:player-volume-v2"
export const DEFAULT_PLAYER_VOLUME = 0.4

/** Volume to apply when unmuting; never leave the player at a silent level. */
export function resolveUnmuteVolume(preferredVolume: number): number {
  return preferredVolume > 0.01 ? preferredVolume : DEFAULT_PLAYER_VOLUME
}

export type PlayerVolumeChangeDetail = {
  volume: number
  muted: boolean
  /** False while a new source is loading (Vidstack queues volume until canplay). */
  mediaReady?: boolean
  /** True during the short post-canplay window that ignores provider 0/1 defaults. */
  volumeSettling?: boolean
}

/** How long after canplay extreme provider defaults (0/1) must not clobber preference. */
export const VOLUME_SETTLING_MS = 750

const volumeSettlingUntilByReadyRef = new WeakMap<object, number>()

/** Mark a short post-canplay window where volume=0/1 defaults are ignored. */
export function markVolumeSettling(
  mediaReadyRef: object,
  durationMs = VOLUME_SETTLING_MS,
): void {
  volumeSettlingUntilByReadyRef.set(mediaReadyRef, Date.now() + durationMs)
}

export function isVolumeSettling(
  mediaReadyRef: object,
  nowMs = Date.now(),
): boolean {
  return nowMs < (volumeSettlingUntilByReadyRef.get(mediaReadyRef) ?? 0)
}

/**
 * Whether a volume-change event should update the stored preference.
 *
 * HTMLMediaElement / Vidstack default volume is 1, and the controlled `volume`
 * prop is applied only after canplay. During load (and while muted) providers
 * emit volume=0/1 as side-effects — those must not clobber the user's level.
 * Immediately after canplay, the same extremes are still treated as defaults
 * ({@link markVolumeSettling}) so a late provider `volumechange(1)` cannot
 * persist 100% before the preferred level sticks.
 */
export function shouldPersistVolumeChange(input: {
  nextVolume: number
  nextMuted: boolean
  preferredVolume: number
  mediaReady: boolean
  /** True during the short post-canplay settling window. */
  volumeSettling?: boolean
}): boolean {
  const {
    nextVolume,
    nextMuted,
    preferredVolume,
    mediaReady,
    volumeSettling = false,
  } = input
  const isExtreme = nextVolume <= 0.01 || nextVolume >= 0.999
  if (!isExtreme) {
    return true
  }
  if (Math.abs(nextVolume - preferredVolume) <= 0.001) {
    return true
  }
  // Mute side-effects, pre-canplay defaults, or post-canplay provider resets.
  if (nextMuted || !mediaReady || volumeSettling) {
    return false
  }
  return true
}

export function usePlayerVolume() {
  const [preferredVolume, setPreferredVolume] = useState(() =>
    readClampedNumberFromStorage(PLAYER_VOLUME_STORAGE_KEY, {
      min: 0,
      max: 1,
      fallback: DEFAULT_PLAYER_VOLUME,
    }),
  )
  // Always start muted so autoplay is allowed after reload; volume is restored on unmute.
  const [isMuted, setIsMuted] = useState(true)

  const persistVolume = (volume: number) => {
    setPreferredVolume(volume)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PLAYER_VOLUME_STORAGE_KEY, String(volume))
    }
  }

  const handleVolumeChange = (detail: PlayerVolumeChangeDetail) => {
    const nextVolume = clampNumber(detail.volume, 0, 1, DEFAULT_PLAYER_VOLUME)
    const nextMuted = Boolean(detail.muted)
    setIsMuted(nextMuted)

    if (
      !shouldPersistVolumeChange({
        nextVolume,
        nextMuted,
        preferredVolume,
        // Call sites that omit mediaReady are treated as ready (user chrome).
        mediaReady: detail.mediaReady !== false,
        volumeSettling: detail.volumeSettling === true,
      })
    ) {
      return
    }

    persistVolume(nextVolume)
  }

  /** Unmute and return the volume that must be applied to the player. */
  const unmute = (): number => {
    const volume = resolveUnmuteVolume(preferredVolume)
    persistVolume(volume)
    setIsMuted(false)
    return volume
  }

  return { preferredVolume, isMuted, handleVolumeChange, unmute }
}
