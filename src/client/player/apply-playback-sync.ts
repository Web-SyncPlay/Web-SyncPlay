import {
  computeExpectedPlaybackTimeSec,
  DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
  isPlaybackDriftBeyondThreshold,
  measurePlaybackDriftSec,
  resolveSeekCeilingSec,
  type PlaybackSyncState,
} from "@/client/player/playback-sync"
import { serverNowEstimateMs } from "@/shared/server-clock"

export type ApplyPlaybackClockResult = {
  seekAttempted: boolean
  /** Absolute drift after the apply attempt; `null` if unmeasurable. */
  driftSec: number | null
}

export type SyncablePlayer = {
  playbackRate: number
  currentTime: number
  /** Media duration in seconds when known; used to clamp EOF seeks. */
  duration?: number
  /**
   * Live/DVR seekable window end. When set, preferred over `duration` so
   * room sync can reach the live edge even if duration lags.
   */
  seekableEnd?: number
  /** Underlying media element — used when the player wrapper no-ops seeks. */
  mediaEl?: Pick<HTMLMediaElement, "currentTime"> | null
  paused?: boolean
  pause: () => void
  play: () => Promise<void> | void
}

/**
 * Real playhead in seconds: prefer the underlying media element (what the
 * viewer actually sees/hears) over the player wrapper, which can lag or no-op
 * for HLS/proxy/local HTTP sources.
 */
export function readPlayerPlayheadSec(
  player: Pick<SyncablePlayer, "currentTime" | "mediaEl">,
): number {
  const mediaTime = Number(player.mediaEl?.currentTime)
  if (Number.isFinite(mediaTime)) {
    return mediaTime
  }
  return Number(player.currentTime ?? 0)
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
  seekableEndSec?: number
}): ApplyPlaybackClockResult & { playAttempt: Promise<void> | null } {
  const {
    player,
    syncState,
    driftThresholdSec = DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
    nowMs = serverNowEstimateMs(),
    mode = "full",
    seekableEndSec,
  } = config

  const clock = applyPlaybackClockToPlayer({
    player,
    syncState,
    driftThresholdSec,
    nowMs,
    seekableEndSec,
  })

  if (mode === "clock") {
    return { ...clock, playAttempt: null }
  }

  return {
    ...clock,
    ...nudgePlaybackTransport({
      player,
      paused: syncState.paused,
    }),
  }
}

/** Rate + timeline only — use when `paused` / `autoPlay` are bound declaratively. */
export function applyPlaybackClockToPlayer(config: {
  player: Pick<
    SyncablePlayer,
    "playbackRate" | "currentTime" | "duration" | "seekableEnd" | "mediaEl"
  >
  syncState: PlaybackSyncState
  driftThresholdSec?: number
  nowMs?: number
  seekableEndSec?: number
}): ApplyPlaybackClockResult {
  const {
    player,
    syncState,
    driftThresholdSec = DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
    nowMs = serverNowEstimateMs(),
    seekableEndSec,
  } = config

  const nextRate = Number(syncState.playbackRate)
  if (Number.isFinite(nextRate)) {
    try {
      player.playbackRate = nextRate
    } catch {
      // Provider may reject rate changes while rebuilding.
    }
  }

  const expectedTimeSec = computeExpectedPlaybackTimeSec(syncState, nowMs)
  const durationSec = Number(player.duration)
  const resolvedSeekableEnd = Number.isFinite(Number(seekableEndSec))
    ? Number(seekableEndSec)
    : Number(player.seekableEnd)
  // Keep seeks inside the media so an unpaused room past EOF cannot restart
  // the last few frames in a tight loop. Prefer seekableEnd for live/DVR.
  const ceiling = resolveSeekCeilingSec({
    durationSec,
    seekableEndSec: resolvedSeekableEnd,
  })
  const clampedExpectedSec =
    ceiling !== null ? Math.min(expectedTimeSec, ceiling) : expectedTimeSec
  const currentTimeSec = readPlayerPlayheadSec(player)
  let seekAttempted = false
  if (
    Number.isFinite(currentTimeSec) &&
    Number.isFinite(clampedExpectedSec) &&
    isPlaybackDriftBeyondThreshold(
      currentTimeSec,
      clampedExpectedSec,
      driftThresholdSec,
    )
  ) {
    // Write wrapper and media element independently: a throwing/no-op wrapper
    // setter must not block the element (Vidstack live/HLS often ignores the
    // wrapper write while the element still accepts the seek).
    try {
      player.currentTime = clampedExpectedSec
    } catch {
      // Ignore transient seek failures while provider is rebuilding.
    }
    if (player.mediaEl) {
      try {
        player.mediaEl.currentTime = clampedExpectedSec
      } catch {
        // Element may be detached during provider swap.
      }
    }
    seekAttempted = true
  }

  return {
    seekAttempted,
    driftSec: measurePlaybackDriftSec(
      readPlayerPlayheadSec(player),
      syncState,
      nowMs,
      durationSec,
      resolvedSeekableEnd,
    ),
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
