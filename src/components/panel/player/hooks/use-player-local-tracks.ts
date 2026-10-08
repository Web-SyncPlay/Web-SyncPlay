"use client"

import {
  audioTrackStorageValue,
  findStoredAudioTrackIndex,
  findStoredVideoQualityIndex,
  snapshotAudioTracks,
  snapshotVideoQualities,
  trackStorageKey,
  videoQualityStorageValue,
  type LocalAudioTrackOption,
  type LocalVideoQualityOption,
} from "@/lib/player-local-tracks"
import type { MediaPlayerInstance } from "@vidstack/react"
import { useEffect, useState, type RefObject } from "react"

export type { LocalAudioTrackOption, LocalVideoQualityOption }

function readStoredValue(key: string | null): string | null {
  if (!key || typeof window === "undefined") {
    return null
  }
  return window.localStorage.getItem(key)
}

function writeStoredValue(key: string | null, value: string) {
  if (!key || typeof window === "undefined") {
    return
  }
  window.localStorage.setItem(key, value)
}

function restoreAudioTrack(player: MediaPlayerInstance, itemId?: string) {
  const stored = readStoredValue(trackStorageKey(itemId, "audio"))
  const matchIndex = findStoredAudioTrackIndex([...player.audioTracks], stored)
  const match = matchIndex >= 0 ? player.audioTracks[matchIndex] : undefined
  if (match && !match.selected) {
    match.selected = true
  }
}

function restoreVideoQuality(player: MediaPlayerInstance, itemId?: string) {
  const stored = readStoredValue(trackStorageKey(itemId, "video"))
  const match = findStoredVideoQualityIndex([...player.qualities], stored)
  if (match === "auto") {
    if (!player.qualities.auto) {
      player.qualities.autoSelect()
    }
    return
  }
  if (match < 0) {
    return
  }
  const quality = player.qualities[match]
  if (quality && !quality.selected) {
    quality.selected = true
  }
}

/**
 * Local-only audio track + in-manifest video quality selection.
 * Preferences stay in this browser tab/device (localStorage), never room sync.
 */
export function usePlayerLocalTracks(options: {
  playerRef: RefObject<MediaPlayerInstance | null>
  itemId?: string
  /** Remount / source changes. */
  syncKey: string
  enabled: boolean
}) {
  const { playerRef, itemId, syncKey, enabled } = options
  const [audioTracks, setAudioTracks] = useState<LocalAudioTrackOption[]>([])
  const [videoQualities, setVideoQualities] = useState<
    LocalVideoQualityOption[]
  >([])

  useEffect(() => {
    if (!enabled) {
      return
    }

    let cancelled = false
    let attempts = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let syncTimer: ReturnType<typeof setTimeout> | null = null
    let player: MediaPlayerInstance | null = null

    const publish = () => {
      if (cancelled || !player) {
        return
      }
      setAudioTracks(snapshotAudioTracks([...player.audioTracks]))
      setVideoQualities(
        snapshotVideoQualities({
          qualities: [...player.qualities],
          auto: player.qualities.auto,
        }),
      )
    }

    // Restore only when the catalog of options changes — never on `change`,
    // or a just-selected track can be overwritten by a stale storage read.
    const restoreFromStorage = () => {
      if (cancelled || !player) {
        return
      }
      restoreAudioTrack(player, itemId)
      restoreVideoQuality(player, itemId)
      publish()
    }

    const bind = (instance: MediaPlayerInstance) => {
      player = instance
      instance.audioTracks.addEventListener("add", restoreFromStorage)
      instance.audioTracks.addEventListener("remove", publish)
      instance.audioTracks.addEventListener("change", publish)
      instance.qualities.addEventListener("add", restoreFromStorage)
      instance.qualities.addEventListener("remove", publish)
      instance.qualities.addEventListener("change", publish)
      instance.qualities.addEventListener("auto-change", publish)
      // Tracks often appear after canplay; restore once now and on later `add`.
      syncTimer = setTimeout(restoreFromStorage, 0)
    }

    const unbind = () => {
      if (!player) {
        return
      }
      player.audioTracks.removeEventListener("add", restoreFromStorage)
      player.audioTracks.removeEventListener("remove", publish)
      player.audioTracks.removeEventListener("change", publish)
      player.qualities.removeEventListener("add", restoreFromStorage)
      player.qualities.removeEventListener("remove", publish)
      player.qualities.removeEventListener("change", publish)
      player.qualities.removeEventListener("auto-change", publish)
      player = null
    }

    const tryBind = () => {
      if (cancelled) {
        return
      }
      const instance = playerRef.current
      if (!instance) {
        attempts += 1
        if (attempts < 40) {
          retryTimer = setTimeout(tryBind, 100)
        }
        return
      }
      bind(instance)
    }

    tryBind()

    return () => {
      cancelled = true
      if (retryTimer) {
        clearTimeout(retryTimer)
      }
      if (syncTimer) {
        clearTimeout(syncTimer)
      }
      unbind()
    }
  }, [enabled, itemId, playerRef, syncKey])

  const selectAudioTrack = (index: number) => {
    const player = playerRef.current
    if (!player) {
      return
    }
    const track = player.audioTracks[index]
    if (!track) {
      return
    }
    // Persist before selecting so a synchronous `change` → publish path cannot
    // restore a stale preference over the user's choice.
    writeStoredValue(
      trackStorageKey(itemId, "audio"),
      audioTrackStorageValue(track, index),
    )
    track.selected = true
  }

  const selectVideoQuality = (index: number) => {
    const player = playerRef.current
    if (!player) {
      return
    }
    if (index < 0) {
      writeStoredValue(trackStorageKey(itemId, "video"), "auto")
      player.qualities.autoSelect()
      return
    }
    const quality = player.qualities[index]
    if (!quality) {
      return
    }
    writeStoredValue(
      trackStorageKey(itemId, "video"),
      videoQualityStorageValue(quality, false),
    )
    quality.selected = true
  }

  return {
    audioTracks: enabled ? audioTracks : [],
    videoQualities: enabled ? videoQualities : [],
    selectAudioTrack,
    selectVideoQuality,
  }
}
