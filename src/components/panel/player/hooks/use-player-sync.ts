"use client"

import {
  applyPlaybackSyncToPlayer,
  type SyncablePlayer,
} from "@/lib/apply-playback-sync"
import type { PlaybackSyncState } from "@/lib/playback-sync"
import { useCallback } from "react"

export function usePlayerSync() {
  const applySyncToPlayer = useCallback(
    (config: {
      player: SyncablePlayer
      syncState: PlaybackSyncState
      driftThresholdSec?: number
    }) => {
      try {
        return applyPlaybackSyncToPlayer(config)
      } catch {
        // Never allow sync application to crash event handlers.
        return { playAttempt: null }
      }
    },
    [],
  )

  return { applySyncToPlayer }
}
