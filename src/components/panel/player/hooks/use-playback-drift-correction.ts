"use client"

import { measurePlaybackDriftSec } from "@/lib/playback-sync"
import {
  queryPlayerMediaElement,
  readMediaSeekableEndSec,
} from "@/lib/player-utils"
import type { MediaPlayerInstance } from "@vidstack/react"
import {
  useEffect,
  useRef,
  type RefObject,
} from "react"
import type { PendingSyncState } from "./use-buffering-watchdog"

const DRIFT_THRESHOLD_SEC = 0.8
const WATCHDOG_INTERVAL_MS = 1_000
/** HLS often no-ops the first currentTime write; retry while the anchor is fresh. */
const ANCHOR_RETRY_DELAYS_MS = [200, 600, 1_200, 2_400] as const

function readPlayerPlayheadSec(player: MediaPlayerInstance) {
  const mediaEl = queryPlayerMediaElement(player.el)
  const mediaTime = Number(mediaEl?.currentTime)
  if (Number.isFinite(mediaTime)) {
    return mediaTime
  }
  return Number(player.currentTime ?? 0)
}

function readPlayerSeekableEndSec(player: MediaPlayerInstance) {
  const mediaEl = queryPlayerMediaElement(player.el)
  return (
    readMediaSeekableEndSec(mediaEl) ??
    (Number.isFinite(Number(player.state.seekableEnd))
      ? Number(player.state.seekableEnd)
      : undefined)
  )
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

  const holdLocalSeekRef = useRef(holdLocalSeek)
  holdLocalSeekRef.current = holdLocalSeek
  const applyRoomClockRef = useRef(applyRoomClock)
  applyRoomClockRef.current = applyRoomClock
  const retryTimersRef = useRef<number[]>([])

  const clearRetryTimers = () => {
    for (const id of retryTimersRef.current) {
      window.clearTimeout(id)
    }
    retryTimersRef.current = []
  }

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

        const syncState: PendingSyncState = {
          paused: playbackRef.current.paused,
          playbackRate: playbackRef.current.playbackRate,
          timelineAnchorMs: playbackRef.current.timelineAnchorMs,
          serverNowMs: playbackRef.current.serverNowMs,
          videoLoop: playbackRef.current.videoLoop !== "off",
        }
        const driftSec = measurePlaybackDriftSec(
          readPlayerPlayheadSec(player),
          syncState,
          Date.now(),
          Number(player.duration),
          readPlayerSeekableEndSec(player),
        )
        if (driftSec === null || driftSec <= DRIFT_THRESHOLD_SEC) {
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
        ({
          paused: playbackRef.current.paused,
          playbackRate: playbackRef.current.playbackRate,
          timelineAnchorMs: playbackRef.current.timelineAnchorMs,
          serverNowMs: playbackRef.current.serverNowMs,
          videoLoop: playbackRef.current.videoLoop !== "off",
        } satisfies PendingSyncState)
      const driftSec = measurePlaybackDriftSec(
        readPlayerPlayheadSec(player),
        syncState,
        Date.now(),
        Number(player.duration),
        readPlayerSeekableEndSec(player),
      )
      if (driftSec === null) {
        return
      }
      if (driftSec <= DRIFT_THRESHOLD_SEC) {
        pendingSyncRef.current = null
        return
      }

      applyRoomClockRef.current(player, {
        paused: playbackRef.current.paused,
        playbackRate: playbackRef.current.playbackRate,
        timelineAnchorMs: playbackRef.current.timelineAnchorMs,
        serverNowMs: playbackRef.current.serverNowMs,
        videoLoop: playbackRef.current.videoLoop !== "off",
      }, 0)
    }, WATCHDOG_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [isMediaReadyRef, pendingSyncRef, playbackRef, playerRef])
}
