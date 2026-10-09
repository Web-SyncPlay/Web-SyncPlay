"use client"

import {
  DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
  measurePlaybackDriftSec,
} from "@/lib/playback-sync"
import {
  readPlayerPlayheadSec,
  readPlayerSeekableEndSec,
} from "@/lib/player-utils"
import { serverNowEstimateMs } from "@/lib/server-clock"
import type { MediaPlayerInstance } from "@vidstack/react"
import {
  useEffect,
  useRef,
  type RefObject,
} from "react"
import { useLatestRef } from "@/hooks/use-latest-ref"
import {
  pendingSyncFromPlayback,
  type PendingSyncState,
} from "./use-buffering-watchdog"

const WATCHDOG_INTERVAL_MS = 1_000
/** HLS often no-ops the first currentTime write; retry while the anchor is fresh. */
const ANCHOR_RETRY_DELAYS_MS = [200, 600, 1_200, 2_400] as const
/** Cap force-threshold seeks per anchor to avoid HLS seek storms. */
const MAX_FORCE_SEEKS_PER_ANCHOR = 4

/**
 * Resolve the sync snapshot for a watchdog tick, then decide apply vs clear.
 * Measure and apply must share this same `syncState` (not a fresh playback read).
 */
export function planPlaybackDriftCorrection(input: {
  pending: PendingSyncState | null
  playback: {
    paused: boolean
    playbackRate: number
    timelineAnchorMs: number
    serverNowMs: number
    videoLoop: string | boolean
  }
  driftSec: number | null
  thresholdSec?: number
}):
  | { action: "noop"; syncState: PendingSyncState }
  | { action: "clear"; syncState: PendingSyncState }
  | { action: "apply"; syncState: PendingSyncState } {
  const syncState =
    input.pending ?? pendingSyncFromPlayback(input.playback)
  if (input.driftSec === null) {
    return { action: "noop", syncState }
  }
  const threshold =
    input.thresholdSec ?? DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC
  if (input.driftSec <= threshold) {
    return { action: "clear", syncState }
  }
  return { action: "apply", syncState }
}

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

  const holdLocalSeekRef = useLatestRef(holdLocalSeek)
  const applyRoomClockRef = useLatestRef(applyRoomClock)
  const retryTimersRef = useRef<number[]>([])
  const forceSeeksForAnchorRef = useRef({
    anchorMs: timelineAnchorMs,
    count: 0,
  })

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
      serverNowEstimateMs(),
      Number(player.duration),
      readPlayerSeekableEndSec(player),
    )

  const tryForceSeek = (
    player: MediaPlayerInstance,
    syncState: PendingSyncState,
    anchorMs: number,
  ) => {
    if (forceSeeksForAnchorRef.current.anchorMs !== anchorMs) {
      forceSeeksForAnchorRef.current = { anchorMs, count: 0 }
    }
    if (forceSeeksForAnchorRef.current.count >= MAX_FORCE_SEEKS_PER_ANCHOR) {
      return
    }
    forceSeeksForAnchorRef.current.count += 1
    // First force seek uses threshold 0; later retries use the default threshold
    // so we do not spam seeks when HLS keeps no-op'ing.
    const threshold =
      forceSeeksForAnchorRef.current.count === 1
        ? 0
        : DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC
    applyRoomClockRef.current(player, syncState, threshold)
  }

  // Burst retries after an authority seek — HLS/proxy often ignores the first write.
  useEffect(() => {
    clearRetryTimers()
    forceSeeksForAnchorRef.current = {
      anchorMs: timelineAnchorMs,
      count: 0,
    }
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

        tryForceSeek(player, syncState, anchorAtSchedule)
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
      const plan = planPlaybackDriftCorrection({
        pending: pendingSyncRef.current,
        playback: playbackRef.current,
        driftSec: measureDrift(player, syncState),
      })
      if (plan.action === "noop") {
        return
      }
      if (plan.action === "clear") {
        pendingSyncRef.current = null
        return
      }

      tryForceSeek(player, syncState, playbackRef.current.timelineAnchorMs)
    }, WATCHDOG_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [isMediaReadyRef, pendingSyncRef, playbackRef, playerRef])
}
