"use client"

import type { MediaPlayerInstance } from "@vidstack/react"
import { type RefObject, useCallback } from "react"

import type { PlaybackSyncEngine } from "@/client/player/playback-sync-engine"

import { toSyncablePlayer } from "./to-syncable-player"
import type { PendingSyncState } from "./use-buffering-watchdog"

/**
 * Thin React adapter: the only UI-facing entry for `engine.applyRoomClock`.
 * Pair with `usePlaybackDriftCorrection` → `engine.onAuthorityAnchor` for
 * authority-anchor verify bursts. Panel hooks must not bypass this engine path.
 */
export function useApplyRoomClock(config: {
  engine: PlaybackSyncEngine
  /** Native iframe source — playhead comes from provider time only. */
  isNativeSource?: () => boolean
  /** Kept for call-site compatibility; engine host owns readiness. */
  isMediaReadyRef?: RefObject<boolean>
  playbackPausedRef?: RefObject<boolean>
  pendingSyncRef?: RefObject<PendingSyncState | null>
  lastAppliedTimelineAnchorMsRef?: RefObject<number | null>
  onApplyFailed?: (syncState: PendingSyncState) => void
}) {
  const { engine, isNativeSource } = config

  const applyRoomClock = useCallback(
    (
      player: MediaPlayerInstance,
      syncState: PendingSyncState,
      driftThresholdSec?: number,
    ) => {
      engine.applyRoomClock(
        toSyncablePlayer(player, { native: isNativeSource?.() ?? false }),
        syncState,
        driftThresholdSec,
      )
    },
    [engine, isNativeSource],
  )

  const clearTransportNudge = useCallback(() => {
    engine.clearTransportNudge()
  }, [engine])

  return { applyRoomClock, clearTransportNudge }
}
