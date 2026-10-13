"use client"

import {
  pendingSyncFromPlayback,
  type PendingSyncPlaybackInput,
  type PendingSyncState,
} from "@/client/player/pending-sync"
import { useLatestRef } from "@/hooks/use-latest-ref"
import type { MediaPlayerInstance } from "@vidstack/react"
import {
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react"
import { planVisibilityResume } from "./visibility-resume"

export { VISIBILITY_REMOUNT_GRACE_MS } from "./visibility-resume"

/**
 * When a backgrounded tab returns to the foreground, force room-clock apply /
 * transport nudge and flush presence. Browsers often stall load/play while
 * hidden; there is no reliable way to finish that work until visible again.
 */
export function usePlayerVisibilityResume(config: {
  playerRef: RefObject<MediaPlayerInstance | null>
  isMediaReadyRef: RefObject<boolean>
  bufferingSinceRef: RefObject<number | null>
  pendingSyncRef: RefObject<PendingSyncState | null>
  playbackRef: RefObject<PendingSyncPlaybackInput>
  applyRoomClock: (
    player: MediaPlayerInstance,
    syncState: PendingSyncState,
    driftThresholdSec?: number,
  ) => void
  /** Immediate presence sample so peers drop a stale playhead quickly. */
  flushPresence: () => void
  setIsBuffering: (next: boolean) => void
  setPlayerRemountNonce?: Dispatch<SetStateAction<number>>
}): void {
  const {
    playerRef,
    isMediaReadyRef,
    bufferingSinceRef,
    pendingSyncRef,
    playbackRef,
    applyRoomClock,
    flushPresence,
    setIsBuffering,
    setPlayerRemountNonce,
  } = config

  const applyRoomClockRef = useLatestRef(applyRoomClock)
  const flushPresenceRef = useLatestRef(flushPresence)
  const setIsBufferingRef = useLatestRef(setIsBuffering)
  const setPlayerRemountNonceRef = useLatestRef(setPlayerRemountNonce)

  useEffect(() => {
    let remountTimer: number | null = null

    const clearRemountTimer = () => {
      if (remountTimer !== null) {
        window.clearTimeout(remountTimer)
        remountTimer = null
      }
    }

    const onVisible = () => {
      clearRemountTimer()
      flushPresenceRef.current()

      const player = playerRef.current
      const playback = playbackRef.current
      const syncState =
        pendingSyncRef.current ?? pendingSyncFromPlayback(playback)
      pendingSyncRef.current = syncState

      const plan = planVisibilityResume({
        isMediaReady: isMediaReadyRef.current,
      })

      if (plan.action === "apply-clock") {
        if (player) {
          applyRoomClockRef.current(player, syncState, 0)
        }
        return
      }

      // Still loading after background stall — keep buffering UI honest and
      // remount if canplay never arrives shortly after focus.
      bufferingSinceRef.current ??= Date.now()
      setIsBufferingRef.current(true)

      if (!setPlayerRemountNonceRef.current) {
        return
      }
      remountTimer = window.setTimeout(() => {
        remountTimer = null
        if (isMediaReadyRef.current) {
          return
        }
        pendingSyncRef.current = pendingSyncFromPlayback(playbackRef.current)
        isMediaReadyRef.current = false
        bufferingSinceRef.current = Date.now()
        setIsBufferingRef.current(true)
        setPlayerRemountNonceRef.current?.((n) => n + 1)
      }, plan.remountAfterMs)
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        onVisible()
      } else {
        clearRemountTimer()
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      clearRemountTimer()
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [
    applyRoomClockRef,
    bufferingSinceRef,
    flushPresenceRef,
    isMediaReadyRef,
    pendingSyncRef,
    playbackRef,
    playerRef,
    setIsBufferingRef,
    setPlayerRemountNonceRef,
  ])
}
