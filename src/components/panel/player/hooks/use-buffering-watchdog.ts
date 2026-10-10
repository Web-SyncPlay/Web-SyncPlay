"use client"

import {
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react"
import {
  pendingSyncFromPlayback,
  type PendingSyncState,
} from "@/client/player/pending-sync"
import { useLatestRef } from "@/hooks/use-latest-ref"

export type { PendingSyncState }

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

  // Clock fields tick under live sync; read them from a ref so the watchdog
  // timer is keyed only by buffering identity (not roomPlayback ticks).
  const roomPlaybackRef = useLatestRef(roomPlayback)
  const currentItemRef = useLatestRef(currentItem)
  const currentItemId = currentItem?.id ?? null

  useEffect(() => {
    if (!currentItemId) {
      return
    }
    if (!isBuffering) {
      return
    }

    // Read epoch inside the effect (not during render) so react-hooks/refs is
    // happy; isBuffering false→true re-arms with the latest startedAt.
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

        const playback = roomPlaybackRef.current
        const item = currentItemRef.current

        participantStatusErrorRef.current = "Playback stalled: recovering…"
        console.error("[player] buffering watchdog triggered", {
          itemId: currentItemId,
          itemName: item?.name,
          src: activePlaybackSrc,
          viewType,
          isMediaReady: isMediaReadyRef.current,
          pendingSync: pendingSyncRef.current,
          roomPaused: playback.paused,
          roomRate: playback.playbackRate,
          roomAnchorMs: playback.timelineAnchorMs,
          roomServerNowMs: playback.serverNowMs,
        })

        // Keep a sync state ready to apply after recovery/remount.
        pendingSyncRef.current = pendingSyncFromPlayback(playback)

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
    currentItemId,
    currentItemRef,
    isBuffering,
    isMediaReadyRef,
    participantStatusErrorRef,
    pendingSyncRef,
    roomPlaybackRef,
    setIsBuffering,
    setPlayerRemountNonce,
    viewType,
  ])
}
