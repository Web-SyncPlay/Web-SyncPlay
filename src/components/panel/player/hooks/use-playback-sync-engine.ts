"use client"

import {
  createPlaybackSyncEngine,
  type PlaybackSyncEngine,
} from "@/client/player/playback-sync-engine"
import type { ProviderSyncTuning } from "@/client/player/provider-sync-tuning"
import { useLatestRef } from "@/hooks/use-latest-ref"
import type { MediaPlayerInstance } from "@vidstack/react"
import { useEffect, useRef, type RefObject } from "react"
import { toSyncablePlayer } from "./to-syncable-player"
import type { PendingSyncState } from "./use-buffering-watchdog"

/**
 * Owns a single PlaybackSyncEngine for the player lifecycle.
 * Sibling hooks become thin adapters over this instance.
 */
export function usePlaybackSyncEngine(config: {
  playerRef: RefObject<MediaPlayerInstance | null>
  isMediaReadyRef: RefObject<boolean>
  playbackPausedRef: RefObject<boolean>
  pendingSyncRef: RefObject<PendingSyncState | null>
  lastAppliedTimelineAnchorMsRef: RefObject<number | null>
  catchUpRateRef: RefObject<number | null>
  onCatchUpRateChange?: (next: number | null) => void
  playbackRef: RefObject<{
    paused: boolean
    playbackRate: number
    timelineAnchorMs: number
    serverNowMs: number
    videoLoop: string
  }>
  /** Provider-aware retry knobs (YouTube/Vimeo); `undefined` keeps HLS defaults. */
  getSyncTuning?: () => ProviderSyncTuning | undefined
  /** Catalog duration hint for the native duration gate (Infinity = live). */
  getDurationHintSec?: () => number | null | undefined
  onApplyFailed?: (syncState: PendingSyncState) => void
}): PlaybackSyncEngine {
  const {
    playerRef,
    isMediaReadyRef,
    playbackPausedRef,
    pendingSyncRef,
    lastAppliedTimelineAnchorMsRef,
    catchUpRateRef,
    onCatchUpRateChange,
    playbackRef,
    getSyncTuning,
    getDurationHintSec,
    onApplyFailed,
  } = config

  const onApplyFailedRef = useLatestRef(onApplyFailed)
  const onCatchUpRateChangeRef = useLatestRef(onCatchUpRateChange)
  const getSyncTuningRef = useLatestRef(getSyncTuning)
  const getDurationHintSecRef = useLatestRef(getDurationHintSec)
  const engineRef = useRef<PlaybackSyncEngine | null>(null)

  // Lazy-once init: engine closes over refs; identity stays fixed for the mount.
  /* eslint-disable react-hooks/refs -- create-once sync engine over refs */
  if (engineRef.current == null) {
    engineRef.current = createPlaybackSyncEngine({
      getPlayer: () => {
        const player = playerRef.current
        return player
          ? toSyncablePlayer(player, {
              native: getSyncTuningRef.current?.()?.nativeProvider === true,
            })
          : null
      },
      isMediaReady: () => isMediaReadyRef.current,
      getPlayback: () => playbackRef.current,
      getPendingSync: () => pendingSyncRef.current,
      setPendingSync: (next) => {
        pendingSyncRef.current = next
      },
      getLastAppliedAnchorMs: () => lastAppliedTimelineAnchorMsRef.current,
      setLastAppliedAnchorMs: (next) => {
        lastAppliedTimelineAnchorMsRef.current = next
      },
      isAuthorityPaused: () => playbackPausedRef.current,
      getSyncTuning: () => getSyncTuningRef.current?.(),
      getDurationHintSec: () => getDurationHintSecRef.current?.(),
      getCatchUpRate: () => catchUpRateRef.current,
      setCatchUpRate: (next) => {
        catchUpRateRef.current = next
        onCatchUpRateChangeRef.current?.(next)
      },
      onApplyFailed: (syncState) => {
        onApplyFailedRef.current?.(syncState)
      },
    })
  }

  const engine = engineRef.current
  /* eslint-enable react-hooks/refs */

  useEffect(() => {
    engine.start()
    return () => {
      engine.dispose()
    }
  }, [engine])

  return engine
}
