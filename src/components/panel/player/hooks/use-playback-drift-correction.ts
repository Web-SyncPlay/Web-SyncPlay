"use client"

import {
  planPlaybackDriftCorrection,
  type PlaybackSyncEngine,
} from "@/client/player/playback-sync-engine"
import type { MediaPlayerInstance } from "@vidstack/react"
import { useEffect, type RefObject } from "react"
import type { PendingSyncState } from "./use-buffering-watchdog"

// Re-export for existing unit tests / call sites.
export { planPlaybackDriftCorrection }

/**
 * Thin React adapter: hold-local-seek + `engine.onAuthorityAnchor` verify burst.
 * Together with `useApplyRoomClock`, this is the only room-clock engine surface
 * UI hooks should touch.
 */
export function usePlaybackDriftCorrection(config: {
  engine: PlaybackSyncEngine
  holdLocalSeek: boolean
  timelineAnchorMs: number
  /** Kept for call-site compatibility; engine host owns these. */
  playerRef?: RefObject<MediaPlayerInstance | null>
  isMediaReadyRef?: RefObject<boolean>
  playbackRef?: RefObject<{
    paused: boolean
    playbackRate: number
    timelineAnchorMs: number
    serverNowMs: number
    videoLoop: string
  }>
  pendingSyncRef?: RefObject<PendingSyncState | null>
  applyRoomClock?: (
    player: MediaPlayerInstance,
    syncState: PendingSyncState,
    driftThresholdSec?: number,
  ) => void
}) {
  const { engine, holdLocalSeek, timelineAnchorMs } = config

  useEffect(() => {
    engine.setHoldLocalSeek(holdLocalSeek)
  }, [engine, holdLocalSeek])

  useEffect(() => {
    engine.onAuthorityAnchor(timelineAnchorMs)
  }, [engine, timelineAnchorMs])
}
