"use client"

import type { TypedRoomEventSender } from "@/contracts/room-events"
import { useLatestRef } from "@/hooks/use-latest-ref"
import type { MediaPlayerInstance } from "@vidstack/react"
import { useCallback, useEffect, useRef, type RefObject } from "react"
import { resolvePresenceLoading } from "./presence-loading"
import { readPlayerPausedSafe } from "./to-syncable-player"

export type PresenceHeartbeatSnapshot = {
  paused: boolean
  currentTimeMs: number
  loading: boolean
  error: string | null
}

/**
 * Emits participant:update ticks when pause/loading/error change, time drifts,
 * or a slow heartbeat keeps lastSeen fresh. Kept separate from room-clock sync.
 *
 * Also flushes immediately on mount / playlist index change, and exposes
 * `flushPresence` for visibility-resume catch-up.
 */
export function usePlayerPresenceHeartbeat(config: {
  playerRef: RefObject<MediaPlayerInstance | null>
  participantStatusErrorRef: RefObject<string | null>
  isMediaReadyRef: RefObject<boolean>
  isBuffering: boolean
  playbackErrorLabel: string | undefined
  /** Remount presence loop when the playlist index changes. */
  currentIndex: number
  /** Room authority paused — used for honest loading while backgrounded. */
  roomPaused: boolean
  send: TypedRoomEventSender
  /** Shared playhead read (engine parity); defaults to `player.currentTime`. */
  getPlayheadSec?: () => number
}): { flushPresence: () => void } {
  const {
    playerRef,
    participantStatusErrorRef,
    isMediaReadyRef,
    isBuffering,
    playbackErrorLabel,
    currentIndex,
    roomPaused,
    send,
    getPlayheadSec,
  } = config
  const getPlayheadSecRef = useLatestRef(getPlayheadSec)
  const isBufferingRef = useLatestRef(isBuffering)
  const playbackErrorLabelRef = useLatestRef(playbackErrorLabel)
  const roomPausedRef = useLatestRef(roomPaused)
  const sendRef = useLatestRef(send)

  const lastSentRef = useRef<{
    paused: boolean
    currentTimeMs: number
    loading: boolean
    error: string | null
    at: number
  } | null>(null)

  const readSnapshot = useCallback((): PresenceHeartbeatSnapshot | null => {
    const player = playerRef.current
    if (!player) {
      return null
    }

    const sec = getPlayheadSecRef.current?.() ?? Number(player.currentTime ?? 0)
    const currentTimeMs = Math.max(
      0,
      Math.floor((Number.isFinite(sec) ? sec : 0) * 1000),
    )

    const loading = resolvePresenceLoading({
      hidden: typeof document !== "undefined" && document.hidden,
      isMediaReady: isMediaReadyRef.current,
      isBuffering: isBufferingRef.current,
      roomPaused: roomPausedRef.current,
      currentTimeMs,
    })

    return {
      paused: readPlayerPausedSafe(player),
      currentTimeMs,
      loading,
      // null (not undefined) so JSON keeps the key and the server can clear.
      error:
        playbackErrorLabelRef.current ??
        participantStatusErrorRef.current ??
        null,
    }
  }, [
    getPlayheadSecRef,
    isBufferingRef,
    isMediaReadyRef,
    participantStatusErrorRef,
    playbackErrorLabelRef,
    playerRef,
    roomPausedRef,
  ])

  const sendSnapshot = useCallback(
    (next: PresenceHeartbeatSnapshot, force = false) => {
      const now = Date.now()
      const lastSent = lastSentRef.current
      if (!force && lastSent) {
        const HEARTBEAT_MS = 2_000
        const TIME_DIRTY_MS = 750
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
      }

      lastSentRef.current = { ...next, at: now }
      sendRef.current("participant:update", next)
    },
    [sendRef],
  )

  const flushPresence = useCallback(() => {
    const next = readSnapshot()
    if (!next) {
      return
    }
    sendSnapshot(next, true)
  }, [readSnapshot, sendSnapshot])

  useEffect(() => {
    const player = playerRef.current
    if (!player) {
      return
    }

    // Immediate sample on mount / playlist index change — do not wait for the
    // first 500ms poll (background tabs may throttle that interval heavily).
    const initial = readSnapshot()
    if (initial) {
      sendSnapshot(initial, true)
    }

    const timer = window.setInterval(() => {
      const next = readSnapshot()
      if (!next) {
        return
      }
      sendSnapshot(next, false)
    }, 500)
    return () => window.clearInterval(timer)
  }, [
    currentIndex,
    playerRef,
    readSnapshot,
    sendSnapshot,
    // Re-arm when buffering / error labels change so loading flips promptly.
    isBuffering,
    playbackErrorLabel,
  ])

  return { flushPresence }
}
