"use client"

import {
  DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
  measurePlaybackDriftSec,
} from "@/lib/playback-sync"
import {
  readPlayerPlayheadSec,
  readPlayerSeekableEndSec,
} from "@/lib/player-utils"
import type { MediaPlayerInstance } from "@vidstack/react"
import {
  useEffect,
  useRef,
  type RefObject,
} from "react"
import {
  pendingSyncFromPlayback,
  type PendingSyncState,
} from "./use-buffering-watchdog"

const WATCHDOG_INTERVAL_MS = 1_000
/** HLS often no-ops the first currentTime write; retry while the anchor is fresh. */
const ANCHOR_RETRY_DELAYS_MS = [200, 600, 1_200, 2_400] as const

export function usePlaybackDriftCorrection(config: {
  playerRef: RefObject<MediaPlayerInstance | null>
  isMediaReadyRef: RefObject<boolean>
  playbackRef: RefObject<{
    paused: boolean
    playbackRate: number
    timelineAnchorMs: number
    serverNowMs: number
    videoLoop: string
  }>
  pendingSyncRef: RefObject<PendingSyncState | null>
  /** Local scrub in flight — do not snap the controller back to room clock. */
  holdLocalSeek: boolean
  timelineAnchorMs: number
  applyRoomClock: (
    player: MediaPlayerInstance,
    syncState: PendingSyncState,
    driftThresholdSec?: number,
  ) => void
}) {
  const {
    playerRef,
    isMediaReadyRef,
    playbackRef,
    pendingSyncRef,
    holdLocalSeek,
    timelineAnchorMs,
    applyRoomClock,
  } = config

  const holdLocalSeekRef = useRef(holdLocalSeek)
  const applyRoomClockRef = useRef(applyRoomClock)
  /* eslint-disable react-hooks/refs -- latest flags/callbacks for watchdog timers */
  holdLocalSeekRef.current = holdLocalSeek
  applyRoomClockRef.current = applyRoomClock
  /* eslint-enable react-hooks/refs */
  const retryTimersRef = useRef<number[]>([])

  const clearRetryTimers = () => {
    for (const id of retryTimersRef.current) {
      window.clearTimeout(id)
    }
    retryTimersRef.current = []
  }

  const measureDrift = (player: MediaPlayerInstance, syncState: PendingSyncState) =>
    measurePlaybackDriftSec(
      readPlayerPlayheadSec(player),
      syncState,
      Date.now(),
      Number(player.duration),
      readPlayerSeekableEndSec(player),
    )

  // Burst retries after an authority seek — HLS/proxy often ignores the first write.
  useEffect(() => {
    clearRetryTimers()
    if (holdLocalSeek) {
      return clearRetryTimers
    }

    const anchorAtSchedule = timelineAnchorMs
    for (const delayMs of ANCHOR_RETRY_DELAYS_MS) {
      const timerId = window.setTimeout(() => {
        if (holdLocalSeekRef.current) {
          return
        }
        if (!isMediaReadyRef.current) {
          return
        }
        const player = playerRef.current
        if (!player) {
          return
        }
        if (playbackRef.current.timelineAnchorMs !== anchorAtSchedule) {
          return
        }

        const syncState = pendingSyncFromPlayback(playbackRef.current)
        const driftSec = measureDrift(player, syncState)
        if (
          driftSec === null ||
          driftSec <= DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC
        ) {
          pendingSyncRef.current = null
          return
        }

        applyRoomClockRef.current(player, syncState, 0)
      }, delayMs)
      retryTimersRef.current.push(timerId)
    }

    return clearRetryTimers
  }, [
    holdLocalSeek,
    isMediaReadyRef,
    pendingSyncRef,
    playbackRef,
    playerRef,
    timelineAnchorMs,
  ])

  // Steady drift correction while media is ready (covers silent HLS seek misses).
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (holdLocalSeekRef.current) {
        return
      }
      if (!isMediaReadyRef.current) {
        return
      }
      const player = playerRef.current
      if (!player) {
        return
      }

      const syncState =
        pendingSyncRef.current ??
        pendingSyncFromPlayback(playbackRef.current)
      const driftSec = measureDrift(player, syncState)
      if (driftSec === null) {
        return
      }
      if (driftSec <= DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC) {
        pendingSyncRef.current = null
        return
      }

      applyRoomClockRef.current(
        player,
        pendingSyncFromPlayback(playbackRef.current),
        0,
      )
    }, WATCHDOG_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [isMediaReadyRef, pendingSyncRef, playbackRef, playerRef])
}
