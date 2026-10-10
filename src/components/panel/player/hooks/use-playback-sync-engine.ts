"use client"

import {
  createPlaybackSyncEngine,
  type PlaybackSyncEngine,
} from "@/client/player/playback-sync-engine"
import type { MediaPlayerInstance } from "@vidstack/react"
import { useEffect, useRef, type RefObject } from "react"
import { useLatestRef } from "@/hooks/use-latest-ref"
import type { PendingSyncState } from "./use-buffering-watchdog"
import { toSyncablePlayer } from "./to-syncable-player"

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
  playbackRef: RefObject<{
    paused: boolean
    playbackRate: number
    timelineAnchorMs: number
    serverNowMs: number
    videoLoop: string
  }>
  onApplyFailed?: (syncState: PendingSyncState) => void
}): PlaybackSyncEngine {
  const {
    playerRef,
    isMediaReadyRef,
    playbackPausedRef,
    pendingSyncRef,
    lastAppliedTimelineAnchorMsRef,
    playbackRef,
    onApplyFailed,
  } = config

  const onApplyFailedRef = useLatestRef(onApplyFailed)
  const engineRef = useRef<PlaybackSyncEngine | null>(null)

  // Lazy-once init: engine closes over refs; identity stays fixed for the mount.
  /* eslint-disable react-hooks/refs -- create-once sync engine over refs */
  if (engineRef.current == null) {
    engineRef.current = createPlaybackSyncEngine({
      getPlayer: () => {
        const player = playerRef.current
        return player ? toSyncablePlayer(player) : null
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
