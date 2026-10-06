"use client"

import {
  applyPlaybackSyncToPlayer,
  nudgePlaybackTransport,
  type SyncablePlayer,
} from "@/lib/apply-playback-sync"
import type { PlaybackSyncState } from "@/lib/playback-sync"
import { useCallback } from "react"

export function usePlayerSync() {
  const applyClockToPlayer = useCallback(
    (config: {
      player: SyncablePlayer
      syncState: PlaybackSyncState
      driftThresholdSec?: number
      seekableEndSec?: number
    }) => {
      try {
        return applyPlaybackSyncToPlayer({ ...config, mode: "clock" })
      } catch {
        return { playAttempt: null }
      }
    },
    [],
  )

  const nudgeTransport = useCallback(
    (config: { player: SyncablePlayer; paused: boolean }) => {
      try {
        return nudgePlaybackTransport(config)
      } catch {
        return { playAttempt: null }
      }
    },
    [],
  )

  return { applyClockToPlayer, nudgeTransport }
}
