import { getAdjacentPlaylistIndex } from "@/lib/playback-sync"
import type { PlaybackControlContext } from "./types"

export function createPlaybackActions(config: PlaybackControlContext) {
  const { roomState, send, controlsDisabled, elapsedMs } = config

  let lastSeekPreviewAt = 0
  let pendingSeekPreviewMs: number | null = null
  let seekPreviewTimer: ReturnType<typeof setTimeout> | null = null

  const flushSeekPreview = (targetMs: number, active: boolean) => {
    lastSeekPreviewAt = Date.now()
    pendingSeekPreviewMs = null
    send("seek:preview", { targetMs: Math.max(0, targetMs), active })
  }

  const scheduleSeekPreview = (targetMs: number) => {
    const now = Date.now()
    const minIntervalMs = 120
    if (now - lastSeekPreviewAt >= minIntervalMs) {
      if (seekPreviewTimer) {
        clearTimeout(seekPreviewTimer)
        seekPreviewTimer = null
      }
      flushSeekPreview(targetMs, true)
      return
    }
    pendingSeekPreviewMs = targetMs
    if (seekPreviewTimer) {
      return
    }
    seekPreviewTimer = setTimeout(() => {
      seekPreviewTimer = null
      if (pendingSeekPreviewMs === null) {
        return
      }
      flushSeekPreview(pendingSeekPreviewMs, true)
    }, minIntervalMs - (now - lastSeekPreviewAt))
  }

  return {
    play: (currentTimeMs?: number) => {
      if (controlsDisabled) {
        return
      }

      send("playback:play", { currentTimeMs })
    },
    pause: (currentTimeMs?: number) => {
      if (controlsDisabled) {
        return
      }

      send("playback:pause", { currentTimeMs })
    },
    stepBy: (deltaMs: number) => {
      if (controlsDisabled) {
        return
      }

      send("playback:seek", { targetMs: Math.max(0, elapsedMs + deltaMs) })
    },
    beginSeek: (targetMs: number) => {
      if (controlsDisabled) {
        return
      }

      scheduleSeekPreview(targetMs)
    },
    updateSeek: (targetMs: number) => {
      if (controlsDisabled) {
        return
      }

      scheduleSeekPreview(targetMs)
    },
    endSeekPreview: (targetMs: number) => {
      if (controlsDisabled) {
        return
      }

      if (seekPreviewTimer) {
        clearTimeout(seekPreviewTimer)
        seekPreviewTimer = null
      }
      pendingSeekPreviewMs = null
      flushSeekPreview(targetMs, false)
    },
    commitSeek: (targetMs: number) => {
      if (controlsDisabled) {
        return
      }

      if (seekPreviewTimer) {
        clearTimeout(seekPreviewTimer)
        seekPreviewTimer = null
      }
      pendingSeekPreviewMs = null
      const nextTarget = Math.max(0, targetMs)
      flushSeekPreview(nextTarget, false)
      send("playback:seek", { targetMs: nextTarget })
    },
    selectAdjacent: (direction: "previous" | "next") => {
      if (controlsDisabled) {
        return
      }

      const nextIndex = getAdjacentPlaylistIndex({
        currentIndex: roomState.currentIndex,
        totalItems: roomState.playlist.length,
        loopMode: roomState.playback.playlistLoop,
        direction,
      })
      if (nextIndex === null || nextIndex === roomState.currentIndex) {
        return
      }

      send("playlist:select", { index: nextIndex })
    },
  }
}
