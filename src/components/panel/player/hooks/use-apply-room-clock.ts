"use client"

import {
  DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
  measurePlaybackDriftSec,
} from "@/lib/playback-sync"
import {
  queryPlayerMediaElement,
  readPlayerSeekableEndSec,
} from "@/lib/player-utils"
import { serverNowEstimateMs } from "@/lib/server-clock"
import type { MediaPlayerInstance } from "@vidstack/react"
import {
  useCallback,
  useEffect,
  useRef,
  type RefObject,
} from "react"
import { useLatestRef } from "@/hooks/use-latest-ref"
import type { PendingSyncState } from "./use-buffering-watchdog"
import { usePlayerSync } from "./use-player-sync"

const TRANSPORT_NUDGE_RETRY_MS = 350

/**
 * Apply authoritative room clock to a Vidstack player: seek/rate via clock mode,
 * then nudge transport only when local pause state drifts from room authority.
 */
export function useApplyRoomClock(config: {
  isMediaReadyRef: RefObject<boolean>
  playbackPausedRef: RefObject<boolean>
  pendingSyncRef: RefObject<PendingSyncState | null>
  lastAppliedTimelineAnchorMsRef: RefObject<number | null>
  onApplyFailed?: (syncState: PendingSyncState) => void
}) {
  const {
    isMediaReadyRef,
    playbackPausedRef,
    pendingSyncRef,
    lastAppliedTimelineAnchorMsRef,
    onApplyFailed,
  } = config

  const { applyClockToPlayer, nudgeTransport } = usePlayerSync()
  const playRetryTimerRef = useRef<number | undefined>(undefined)
  const onApplyFailedRef = useLatestRef(onApplyFailed)

  const scheduleTransportNudge = useCallback(
    (player: MediaPlayerInstance) => {
      if (playbackPausedRef.current) {
        return
      }
      if (playRetryTimerRef.current) {
        window.clearTimeout(playRetryTimerRef.current)
      }
      playRetryTimerRef.current = window.setTimeout(() => {
        playRetryTimerRef.current = undefined
        if (!isMediaReadyRef.current) {
          return
        }
        if (playbackPausedRef.current) {
          return
        }
        if (!player.paused) {
          return
        }
        void nudgeTransport({ player, paused: false }).playAttempt
      }, TRANSPORT_NUDGE_RETRY_MS)
    },
    [isMediaReadyRef, nudgeTransport, playbackPausedRef],
  )

  const clearTransportNudge = useCallback(() => {
    if (playRetryTimerRef.current) {
      window.clearTimeout(playRetryTimerRef.current)
      playRetryTimerRef.current = undefined
    }
  }, [])

  useEffect(() => () => clearTransportNudge(), [clearTransportNudge])

  const applyRoomClock = useCallback(
    (
      player: MediaPlayerInstance,
      syncState: PendingSyncState,
      driftThresholdSec?: number,
    ) => {
      try {
        const mediaEl = queryPlayerMediaElement(player.el)
        const seekableEndSec = readPlayerSeekableEndSec(player)
        applyClockToPlayer({
          player: {
            playbackRate: player.playbackRate,
            get currentTime() {
              return player.currentTime
            },
            set currentTime(value: number) {
              player.currentTime = value
            },
            duration: player.duration,
            seekableEnd: seekableEndSec,
            mediaEl,
            paused: player.paused,
            pause: () => player.pause(),
            play: () => player.play(),
          },
          syncState,
          driftThresholdSec,
          seekableEndSec,
        })
        lastAppliedTimelineAnchorMsRef.current = syncState.timelineAnchorMs

        // HLS/proxy often accepts the write asynchronously (or no-ops once).
        // Keep pending until drift correction verifies the playhead caught up.
        const driftSec = measurePlaybackDriftSec(
          Number(mediaEl?.currentTime ?? player.currentTime ?? 0),
          syncState,
          serverNowEstimateMs(),
          Number(player.duration),
          seekableEndSec,
        )
        pendingSyncRef.current =
          driftSec === null ||
          driftSec > DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC
            ? syncState
            : null

        // Declarative `paused`/`autoPlay` own transport; only nudge when the
        // iframe provider drifts away from room authority.
        if (!syncState.paused && player.paused) {
          void nudgeTransport({ player, paused: false }).playAttempt
          scheduleTransportNudge(player)
        } else if (syncState.paused && player.paused === false) {
          void nudgeTransport({ player, paused: true }).playAttempt
        }
      } catch {
        pendingSyncRef.current = syncState
        onApplyFailedRef.current?.(syncState)
      }
    },
    [
      applyClockToPlayer,
      lastAppliedTimelineAnchorMsRef,
      nudgeTransport,
      pendingSyncRef,
      scheduleTransportNudge,
    ],
  )

  return { applyRoomClock, clearTransportNudge }
}
