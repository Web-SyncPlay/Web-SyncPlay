"use client"

import { clampNumber, readClampedNumberFromStorage } from "@/lib/storage-utils"
import { useState } from "react"

export const PLAYER_VOLUME_STORAGE_KEY = "web-syncplay:player-volume"
export const PLAYER_MUTED_STORAGE_KEY = "web-syncplay:player-muted"
const DEFAULT_PLAYER_VOLUME = 0.4

function readMutedFromStorage(fallback: boolean): boolean {
  if (typeof window === "undefined") {
    return fallback
  }
  const stored = window.localStorage.getItem(PLAYER_MUTED_STORAGE_KEY)
  if (stored === null) {
    return fallback
  }
  return stored === "1"
}

export function usePlayerVolume() {
  const [preferredVolume, setPreferredVolume] = useState(() =>
    readClampedNumberFromStorage(PLAYER_VOLUME_STORAGE_KEY, {
      min: 0,
      max: 1,
      fallback: DEFAULT_PLAYER_VOLUME,
    }),
  )
  const [isMuted, setIsMuted] = useState(() => readMutedFromStorage(true))

  const handleVolumeChange = (detail: { volume: number; muted: boolean }) => {
    const nextVolume = clampNumber(detail.volume, 0, 1, DEFAULT_PLAYER_VOLUME)
    const nextMuted = Boolean(detail.muted)
    setPreferredVolume(nextVolume)
    setIsMuted(nextMuted)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PLAYER_VOLUME_STORAGE_KEY, String(nextVolume))
      window.localStorage.setItem(
        PLAYER_MUTED_STORAGE_KEY,
        nextMuted ? "1" : "0",
      )
    }
  }

  return { preferredVolume, isMuted, handleVolumeChange }
}
