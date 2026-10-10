"use client"

import { readClampedNumberFromStorage } from "@/shared/dom/storage-utils"
import { clampNumber } from "@/shared/storage-utils"
import { useState } from "react"

export const PLAYER_VOLUME_STORAGE_KEY = "web-syncplay:player-volume-v2"
export const DEFAULT_PLAYER_VOLUME = 0.4

/** Volume to apply when unmuting; never leave the player at a silent level. */
export function resolveUnmuteVolume(preferredVolume: number): number {
  return preferredVolume > 0.01 ? preferredVolume : DEFAULT_PLAYER_VOLUME
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

  const handleVolumeChange = (detail: { volume: number; muted: boolean }) => {
    const nextVolume = clampNumber(detail.volume, 0, 1, DEFAULT_PLAYER_VOLUME)
    const nextMuted = Boolean(detail.muted)
    setIsMuted(nextMuted)

    // While muted, providers often emit volume=0 or volume=1 as mute side-effects
    // before our preferred level sticks. Ignoring those extremes keeps the stored
    // preference (default 40%) intact for unmute.
    if (nextMuted && (nextVolume <= 0.01 || nextVolume >= 0.999)) {
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
