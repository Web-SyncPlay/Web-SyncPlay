"use client"

import {
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react"

export interface PendingSyncState {
  paused: boolean
  playbackRate: number
  timelineAnchorMs: number
  serverNowMs: number
  videoLoop: boolean
}

/** Build pending sync from room playback (string or boolean loop field). */
export function pendingSyncFromPlayback(playback: {
  paused: boolean
  playbackRate: number
  timelineAnchorMs: number
  serverNowMs: number
  videoLoop: string | boolean
}): PendingSyncState {
  return {
    paused: playback.paused,
    playbackRate: playback.playbackRate,
    timelineAnchorMs: playback.timelineAnchorMs,
    serverNowMs: playback.serverNowMs,
    videoLoop:
      typeof playback.videoLoop === "boolean"
        ? playback.videoLoop
        : playback.videoLoop !== "off",
  }
}

export function useBufferingWatchdog(config: {
  currentItem: { id: string; name: string } | null
  activePlaybackSrc: string
  viewType: "audio" | "video"
  isBuffering: boolean
  isMediaReadyRef: RefObject<boolean>
  bufferingSinceRef: RefObject<number | null>
  participantStatusErrorRef: RefObject<string | null>
  pendingSyncRef: RefObject<PendingSyncState | null>
  roomPlayback: {
    paused: boolean
    playbackRate: number
    timelineAnchorMs: number
    serverNowMs: number
    videoLoop: string
  }
  setIsBuffering: (next: boolean) => void
  setPlayerRemountNonce: Dispatch<SetStateAction<number>>
}) {
  const {
    currentItem,
    activePlaybackSrc,
    viewType,
    isBuffering,
    isMediaReadyRef,
    bufferingSinceRef,
    participantStatusErrorRef,
    pendingSyncRef,
    roomPlayback,
    setIsBuffering,
    setPlayerRemountNonce,
  } = config

  useEffect(() => {
    if (!currentItem) {
      return
    }
    if (!isBuffering) {
      return
    }

    const startedAt = bufferingSinceRef.current
    if (!startedAt) {
      return
    }

    const watchdogMs = 12_000
    const now = Date.now()
    const remainingMs = watchdogMs - (now - startedAt)
    if (remainingMs <= 0) {
      return
    }

    const timer = window.setTimeout(
      () => {
        if (!isBuffering) return
        if (bufferingSinceRef.current !== startedAt) return

        participantStatusErrorRef.current = "Playback stalled: recovering…"
        console.error("[player] buffering watchdog triggered", {
          itemId: currentItem.id,
          itemName: currentItem.name,
          src: activePlaybackSrc,
          viewType,
          isMediaReady: isMediaReadyRef.current,
          pendingSync: pendingSyncRef.current,
          roomPaused: roomPlayback.paused,
          roomRate: roomPlayback.playbackRate,
          roomAnchorMs: roomPlayback.timelineAnchorMs,
          roomServerNowMs: roomPlayback.serverNowMs,
        })

        // Keep a sync state ready to apply after recovery/remount.
        pendingSyncRef.current = {
          paused: roomPlayback.paused,
          playbackRate: roomPlayback.playbackRate,
          timelineAnchorMs: roomPlayback.timelineAnchorMs,
          serverNowMs: roomPlayback.serverNowMs,
          videoLoop: roomPlayback.videoLoop !== "off",
        }

        isMediaReadyRef.current = false
        setIsBuffering(true)
        setPlayerRemountNonce((n) => n + 1)
      },
      Math.max(250, remainingMs),
    )

    return () => window.clearTimeout(timer)
  }, [
    activePlaybackSrc,
    bufferingSinceRef,
    currentItem,
    isBuffering,
    isMediaReadyRef,
    participantStatusErrorRef,
    pendingSyncRef,
    roomPlayback.paused,
    roomPlayback.playbackRate,
    roomPlayback.serverNowMs,
    roomPlayback.timelineAnchorMs,
    roomPlayback.videoLoop,
    setIsBuffering,
    setPlayerRemountNonce,
    viewType,
  ])
}
