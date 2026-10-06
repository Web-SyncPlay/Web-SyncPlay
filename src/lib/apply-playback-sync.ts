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
 * Apply authoritative room playback clock to a local media element.
 *
 * Seek runs before any transport nudge: iframe providers (YouTube/Vimeo) often
 * cancel a just-started play() when currentTime is assigned afterwards.
 *
 * `mode: "clock"` — rate + seek only (room transport is declarative via paused/autoPlay).
 * `mode: "full"` — also imperatively play/pause (recovery / tests).
 */
export function applyPlaybackSyncToPlayer(config: {
  player: SyncablePlayer
  syncState: PlaybackSyncState
  driftThresholdSec?: number
  nowMs?: number
  mode?: "clock" | "full"
}): { playAttempt: Promise<void> | null } {
  const {
    player,
    syncState,
    driftThresholdSec = 0.8,
    nowMs = Date.now(),
    mode = "full",
  } = config

  applyPlaybackClockToPlayer({
    player,
    syncState,
    driftThresholdSec,
    nowMs,
  })

  if (mode === "clock") {
    return { playAttempt: null }
  }

  return nudgePlaybackTransport({
    player,
    paused: syncState.paused,
  })
}

/** Rate + timeline only — use when `paused` / `autoPlay` are bound declaratively. */
export function applyPlaybackClockToPlayer(config: {
  player: Pick<SyncablePlayer, "playbackRate" | "currentTime">
  syncState: PlaybackSyncState
  driftThresholdSec?: number
  nowMs?: number
}): void {
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
}

/** Imperative play/pause when local transport drifts from room authority. */
export function nudgePlaybackTransport(config: {
  player: Pick<SyncablePlayer, "paused" | "pause" | "play">
  paused: boolean
}): { playAttempt: Promise<void> | null } {
  const { player, paused } = config

  if (paused) {
    if (player.paused === false || player.paused === undefined) {
      try {
        player.pause()
      } catch {
        // Ignore transient pause failures while provider is rebuilding.
      }
    }
    return { playAttempt: null }
  }

  if (player.paused === false) {
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
