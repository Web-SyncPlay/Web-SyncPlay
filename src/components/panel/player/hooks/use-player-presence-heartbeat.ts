"use client"

import type { TypedRoomEventSender } from "@/contracts/room-events"
import type { MediaPlayerInstance } from "@vidstack/react"
import { useEffect, type RefObject } from "react"

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
}): void {
  const {
    playerRef,
    participantStatusErrorRef,
    isBuffering,
    playbackErrorLabel,
    currentIndex,
    send,
  } = config

  useEffect(() => {
    const player = playerRef.current
    if (!player) {
      return
    }

    const HEARTBEAT_MS = 2_000
    const TIME_DIRTY_MS = 750
    let lastSent = {
      paused: Boolean(player.paused),
      currentTimeMs: Math.max(
        0,
        Math.floor(Number(player.currentTime ?? 0) * 1000),
      ),
      loading: isBuffering,
      // Send null (not undefined) so JSON keeps the key and the server can clear.
      error: playbackErrorLabel ?? participantStatusErrorRef.current ?? null,
      at: 0,
    }

    const timer = window.setInterval(() => {
      const next = {
        paused: Boolean(player.paused),
        currentTimeMs: Math.max(
          0,
          Math.floor(Number(player.currentTime ?? 0) * 1000),
        ),
        loading: isBuffering,
        error: playbackErrorLabel ?? participantStatusErrorRef.current ?? null,
      }
      const now = Date.now()
      const dirty =
        next.paused !== lastSent.paused ||
        next.loading !== lastSent.loading ||
        next.error !== lastSent.error ||
        Math.abs(next.currentTimeMs - lastSent.currentTimeMs) >= TIME_DIRTY_MS ||
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
    send,
  ])
}
