import {
  computeExpectedPlaybackTimeSec,
  isPlaybackDriftBeyondThreshold,
  type PlaybackSyncState,
} from "@/lib/playback-sync"

export type SyncablePlayer = {
  playbackRate: number
  currentTime: number
  paused?: boolean
  pause: () => void
  play: () => Promise<void> | void
}

/**
 * Apply authoritative room playback state to a local media element.
 *
 * Order matters for iframe providers (YouTube/Vimeo): seek before play/pause,
 * otherwise play() can resolve while the provider stays visually stuck, and a
 * post-play seek often cancels the just-started playback.
 */
export function applyPlaybackSyncToPlayer(config: {
  player: SyncablePlayer
  syncState: PlaybackSyncState
  driftThresholdSec?: number
  nowMs?: number
}): { playAttempt: Promise<void> | null } {
  const { player, syncState, driftThresholdSec = 0.8, nowMs = Date.now() } =
    config

  const nextRate = Number(syncState.playbackRate)
  if (Number.isFinite(nextRate)) {
    try {
      player.playbackRate = nextRate
    } catch {
      // Provider may reject rate changes while rebuilding.
    }
  }

  const expectedTimeSec = computeExpectedPlaybackTimeSec(syncState, nowMs)
  const currentTimeSec = Number(player.currentTime ?? 0)
  if (
    Number.isFinite(currentTimeSec) &&
    Number.isFinite(expectedTimeSec) &&
    isPlaybackDriftBeyondThreshold(
      currentTimeSec,
      expectedTimeSec,
      driftThresholdSec,
    )
  ) {
    try {
      player.currentTime = expectedTimeSec
    } catch {
      // Ignore transient seek failures while provider is rebuilding.
    }
  }

  if (syncState.paused) {
    try {
      player.pause()
    } catch {
      // Ignore transient pause failures while provider is rebuilding.
    }
    return { playAttempt: null }
  }

  try {
    const playResult = player.play()
    if (
      playResult &&
      typeof (playResult as Promise<void>).then === "function"
    ) {
      const playAttempt = (playResult as Promise<void>).catch(() => {
        // Autoplay policies / provider races — caller may retry.
      })
      return { playAttempt }
    }
  } catch {
    // Ignore synchronous play failures; caller may retry on next sync.
  }

  return { playAttempt: null }
}
