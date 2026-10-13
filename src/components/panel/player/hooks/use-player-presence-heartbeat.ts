"use client"

import type { TypedRoomEventSender } from "@/contracts/room-events"
import { useLatestRef } from "@/hooks/use-latest-ref"
import type { MediaPlayerInstance } from "@vidstack/react"
import { useEffect, type RefObject } from "react"
import { readPlayerPausedSafe } from "./to-syncable-player"

/**
 * Emits participant:update ticks when pause/loading/error change, time drifts,
 * or a slow heartbeat keeps lastSeen fresh. Kept separate from room-clock sync.
 */
export function usePlayerPresenceHeartbeat(config: {
  playerRef: RefObject<MediaPlayerInstance | null>
  participantStatusErrorRef: RefObject<string | null>
  isBuffering: boolean
  playbackErrorLabel: string | undefined
  /** Remount presence loop when the playlist index changes. */
  currentIndex: number
  send: TypedRoomEventSender
  /** Shared playhead read (engine parity); defaults to `player.currentTime`. */
  getPlayheadSec?: () => number
}): void {
  const {
    playerRef,
    participantStatusErrorRef,
    isBuffering,
    playbackErrorLabel,
    currentIndex,
    send,
    getPlayheadSec,
  } = config
  const getPlayheadSecRef = useLatestRef(getPlayheadSec)

  useEffect(() => {
    const player = playerRef.current
    if (!player) {
      return
    }

    const readCurrentTimeMs = () => {
      const sec =
        getPlayheadSecRef.current?.() ?? Number(player.currentTime ?? 0)
      return Math.max(0, Math.floor((Number.isFinite(sec) ? sec : 0) * 1000))
    }
    const HEARTBEAT_MS = 2_000
    const TIME_DIRTY_MS = 750
    let lastSent = {
      paused: readPlayerPausedSafe(player),
      currentTimeMs: readCurrentTimeMs(),
      loading: isBuffering,
      // Send null (not undefined) so JSON keeps the key and the server can clear.
      error: playbackErrorLabel ?? participantStatusErrorRef.current ?? null,
      at: 0,
    }

    const timer = window.setInterval(() => {
      const next = {
        paused: readPlayerPausedSafe(player),
        currentTimeMs: readCurrentTimeMs(),
        loading: isBuffering,
        error: playbackErrorLabel ?? participantStatusErrorRef.current ?? null,
      }
      const now = Date.now()
      const dirty =
        next.paused !== lastSent.paused ||
        next.loading !== lastSent.loading ||
        next.error !== lastSent.error ||
        Math.abs(next.currentTimeMs - lastSent.currentTimeMs) >=
          TIME_DIRTY_MS ||
        now - lastSent.at >= HEARTBEAT_MS
      if (!dirty) {
        return
      }

      lastSent = { ...next, at: now }
      send("participant:update", next)
    }, 500)
    return () => window.clearInterval(timer)
  }, [
    isBuffering,
    participantStatusErrorRef,
    playbackErrorLabel,
    playerRef,
    currentIndex,
    getPlayheadSecRef,
    send,
  ])
}
