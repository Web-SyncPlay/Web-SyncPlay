"use client"

import type { PlaybackSyncEngine } from "@/client/player/playback-sync-engine"
import type { MediaPlayerInstance } from "@vidstack/react"
import { useCallback, type RefObject } from "react"
import type { PendingSyncState } from "./use-buffering-watchdog"
import { toSyncablePlayer } from "./to-syncable-player"

/**
 * Thin React adapter: apply authoritative room clock via PlaybackSyncEngine.
 */
export function useApplyRoomClock(config: {
  engine: PlaybackSyncEngine
  /** Kept for call-site compatibility; engine host owns readiness. */
  isMediaReadyRef?: RefObject<boolean>
  playbackPausedRef?: RefObject<boolean>
  pendingSyncRef?: RefObject<PendingSyncState | null>
  lastAppliedTimelineAnchorMsRef?: RefObject<number | null>
  onApplyFailed?: (syncState: PendingSyncState) => void
}) {
  const { engine } = config

  const applyRoomClock = useCallback(
    (
      player: MediaPlayerInstance,
      syncState: PendingSyncState,
      driftThresholdSec?: number,
    ) => {
      engine.applyRoomClock(
        toSyncablePlayer(player),
        syncState,
        driftThresholdSec,
      )
    },
    [engine],
  )

  const clearTransportNudge = useCallback(() => {
    engine.clearTransportNudge()
  }, [engine])

  return { applyRoomClock, clearTransportNudge }
}
