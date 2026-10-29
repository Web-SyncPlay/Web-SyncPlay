import {
  computeExpectedPlaybackTimeSec,
  DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
  isPlaybackDriftBeyondThreshold,
  measurePlaybackDriftSec,
  type PlaybackSyncState,
  resolveSeekCeilingSec,
} from "@/client/player/playback-sync"
import { serverNowEstimateMs } from "@/shared/server-clock"

export type ApplyPlaybackClockResult = {
  seekAttempted: boolean
  /** Absolute drift after the apply attempt; `null` if unmeasurable. */
  driftSec: number | null
  /** Playhead before the apply (seconds). */
  playheadBeforeSec: number | null
  /** Authority target written (or measured against), after ceiling clamp. */
  targetSec: number | null
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
  /**
   * Underlying media element — used when the player wrapper no-ops seeks or
   * reports `paused` while HLS / local HTTP is still playing.
   */
  mediaEl?: Pick<
    HTMLMediaElement,
    "currentTime" | "paused" | "pause" | "play" | "muted" | "playbackRate"
  > | null
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

type SyncableNumberKey = "playbackRate" | "currentTime"

/**
 * Write a numeric property on the wrapper and, when present, the media
 * element. Failures are isolated so a throwing wrapper cannot block mediaEl
 * (Vidstack live/HLS often ignores the wrapper write).
 */
export function writeSyncableNumber<K extends SyncableNumberKey>(
  player: Pick<SyncablePlayer, K | "mediaEl">,
  key: K,
  value: number,
): void {
  try {
    player[key] = value
  } catch {
    // Provider may reject while rebuilding.
  }
  const el = player.mediaEl
  if (!el) {
    return
  }
  try {
    el[key] = value
  } catch {
    // Element may be detached during provider swap.
  }
}

/**
 * HLS dual-echo: wrapper is near `referenceSec` while mediaEl is still far.
 * Used after seeks (reference = write target) and on verify ticks (reference =
 * room expected time) to prefer force-seek over rate catch-up.
 */
export function isHlsWrapperMediaEcho(input: {
  mediaSec: number | null | undefined
  wrapperSec: number | null | undefined
  referenceSec: number
  thresholdSec?: number
}): boolean {
  const threshold = input.thresholdSec ?? DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC
  // Reject null/undefined before Number() — `Number(null) === 0` would
  // false-positive as a mediaEl stuck at 0 while the wrapper echoes.
  if (input.mediaSec == null || input.wrapperSec == null) {
    return false
  }
  const mediaSec = Number(input.mediaSec)
  const wrapperSec = Number(input.wrapperSec)
  if (!Number.isFinite(mediaSec) || !Number.isFinite(wrapperSec)) {
    return false
  }
  if (!Number.isFinite(input.referenceSec)) {
    return false
  }
  return (
    Math.abs(mediaSec - input.referenceSec) > threshold &&
    Math.abs(wrapperSec - input.referenceSec) <= threshold
  )
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
  durationHintSec?: number | null
  isLive?: boolean
  /** Local catch-up / override rate; defaults to `syncState.playbackRate`. */
  effectivePlaybackRate?: number
  /**
   * Seconds to write ahead of the room clock on a seek (playing force snaps).
   * Clamped with `resolveSeekCeilingSec`. Drift is still judged against the
   * unled authority time.
   */
  seekLeadSec?: number
  /**
   * Treat playhead ahead of authority by at most this many seconds as
   * in-threshold (so soft seeks do not undo a prior force-seek lead).
   */
  allowAheadSec?: number
}): ApplyPlaybackClockResult & { playAttempt: Promise<void> | null } {
  const {
    player,
    syncState,
    driftThresholdSec = DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
    nowMs = serverNowEstimateMs(),
    mode = "full",
    seekableEndSec,
    durationHintSec,
    isLive,
    effectivePlaybackRate,
    seekLeadSec,
    allowAheadSec,
  } = config

  const clock = applyPlaybackClockToPlayer({
    player,
    syncState,
    driftThresholdSec,
    nowMs,
    seekableEndSec,
    durationHintSec,
    isLive,
    effectivePlaybackRate,
    seekLeadSec,
    allowAheadSec,
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
  durationHintSec?: number | null
  isLive?: boolean
  /** Local catch-up / override rate; defaults to `syncState.playbackRate`. */
  effectivePlaybackRate?: number
  /**
   * Seconds to write ahead of the room clock on a seek (playing force snaps).
   * Clamped with `resolveSeekCeilingSec`. Drift is still judged against the
   * unled authority time.
   */
  seekLeadSec?: number
  /**
   * Treat playhead ahead of authority by at most this many seconds as
   * in-threshold (so soft seeks do not undo a prior force-seek lead).
   */
  allowAheadSec?: number
}): ApplyPlaybackClockResult {
  const {
    player,
    syncState,
    driftThresholdSec = DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
    nowMs = serverNowEstimateMs(),
    seekableEndSec,
    durationHintSec,
    isLive,
    effectivePlaybackRate,
    seekLeadSec: seekLeadSecRaw = 0,
    allowAheadSec: allowAheadSecRaw = 0,
  } = config
  const seekLeadSec =
    Number.isFinite(seekLeadSecRaw) && seekLeadSecRaw > 0 ? seekLeadSecRaw : 0
  const allowAheadSec =
    Number.isFinite(allowAheadSecRaw) && allowAheadSecRaw > 0
      ? allowAheadSecRaw
      : 0

  const nextRate = Number(
    effectivePlaybackRate !== undefined
      ? effectivePlaybackRate
      : syncState.playbackRate,
  )
  if (Number.isFinite(nextRate)) {
    writeSyncableNumber(player, "playbackRate", nextRate)
  }

  const expectedTimeSec = computeExpectedPlaybackTimeSec(syncState, nowMs)
  const durationSec = Number(player.duration)
  const resolvedSeekableEnd = Number.isFinite(Number(seekableEndSec))
    ? Number(seekableEndSec)
    : Number(player.seekableEnd)
  const ceiling = resolveSeekCeilingSec({
    durationSec,
    seekableEndSec: resolvedSeekableEnd,
    durationHintSec,
    isLive,
  })
  // Authority target (no lead) — used for drift decisions.
  const authoritySec =
    ceiling !== null ? Math.min(expectedTimeSec, ceiling) : expectedTimeSec
  // Write target may lead the room clock; still ceiling-clamped.
  const writeTargetSec =
    ceiling !== null
      ? Math.min(expectedTimeSec + seekLeadSec, ceiling)
      : expectedTimeSec + seekLeadSec
  const currentTimeSec = readPlayerPlayheadSec(player)
  const playheadBeforeSec = Number.isFinite(currentTimeSec)
    ? currentTimeSec
    : null
  let seekAttempted = false
  if (
    playheadBeforeSec !== null &&
    Number.isFinite(authoritySec) &&
    isPlaybackDriftBeyondThreshold(
      playheadBeforeSec,
      authoritySec,
      driftThresholdSec,
      allowAheadSec,
    )
  ) {
    writeSyncableNumber(player, "currentTime", writeTargetSec)
    seekAttempted = true
  }

  return {
    seekAttempted,
    playheadBeforeSec,
    targetSec: Number.isFinite(writeTargetSec) ? writeTargetSec : null,
    driftSec: measurePlaybackDriftSec(
      readPlayerPlayheadSec(player),
      syncState,
      nowMs,
      durationSec,
      resolvedSeekableEnd,
      durationHintSec,
      isLive,
      allowAheadSec,
    ),
  }
}

/**
 * Convergence / transport "is playing" read for the sync engine.
 * When a media element exists, trust it only — declarative
 * `paused={roomPaused}` can make the wrapper report playing while `<video>`
 * is still paused (buffering), which would clear play-unconverged pending.
 * Without a media element (native iframes), fall back to the wrapper flag.
 */
export function isSyncablePlayerPlaying(
  player: Pick<SyncablePlayer, "paused" | "mediaEl">,
): boolean {
  const el = player.mediaEl
  if (el) {
    return el.paused === false
  }
  return player.paused === false || player.paused === undefined
}

/**
 * Paused HLS/proxy often no-ops `currentTime` writes until a play-gated seek.
 * Brief muted play → rewrite target → pause (restore mute). Shared path for
 * all media-element providers — no SoundCloud/HLS-only branches.
 */
export function escalateSeekWhilePaused(config: {
  player: Pick<SyncablePlayer, "currentTime" | "mediaEl" | "pause" | "play">
  targetSec: number
}): void {
  const { player, targetSec } = config
  if (!Number.isFinite(targetSec)) {
    return
  }
  const el = player.mediaEl
  if (!el) {
    return
  }

  let wasMuted = true
  try {
    wasMuted = el.muted === true
    el.muted = true
  } catch {
    // Provider may reject mute while rebuilding.
  }

  try {
    void el.play()
  } catch {
    // Autoplay policies — caller keeps pending and retries later.
  }

  writeSyncableNumber(player, "currentTime", targetSec)

  try {
    el.pause()
  } catch {
    // Ignore.
  }
  try {
    player.pause()
  } catch {
    // Ignore.
  }

  try {
    el.muted = wasMuted
  } catch {
    // Ignore.
  }
}

/** Imperative play/pause when local transport drifts from room authority. */
export function nudgePlaybackTransport(config: {
  player: Pick<SyncablePlayer, "paused" | "pause" | "play" | "mediaEl">
  paused: boolean
}): { playAttempt: Promise<void> | null } {
  const { player, paused } = config

  if (paused) {
    // Always issue pause — wrapper `paused` can already be true from the
    // declarative room binding while the underlying element (blob / HLS /
    // local HTTP relay) is still playing. Idempotent on a truly paused el.
    try {
      player.pause()
    } catch {
      // Ignore transient pause failures while provider is rebuilding.
    }
    const el = player.mediaEl
    if (el) {
      try {
        el.pause()
      } catch {
        // Element may be detached during provider swap.
      }
    }
    return { playAttempt: null }
  }

  // Already playing — same mediaEl-first rule as `isSyncablePlayerPlaying`.
  if (isSyncablePlayerPlaying(player)) {
    return { playAttempt: null }
  }

  let playAttempt: Promise<void> | null = null
  try {
    const playResult = player.play()
    if (
      playResult &&
      typeof (playResult as Promise<void>).then === "function"
    ) {
      playAttempt = (playResult as Promise<void>).catch(() => {
        // Autoplay policies / provider races — caller may retry.
      })
    }
  } catch {
    // Ignore synchronous play failures; caller may retry on next sync.
  }

  // Mirror pause asymmetry: also nudge the underlying element when the
  // wrapper play() no-ops (HLS / local HTTP remounts).
  const el = player.mediaEl
  if (el && el.paused !== false) {
    try {
      const elPlay = el.play()
      if (
        elPlay &&
        typeof (elPlay as Promise<void>).then === "function" &&
        !playAttempt
      ) {
        playAttempt = (elPlay as Promise<void>).catch(() => {
          // Autoplay policies — caller may retry.
        })
      }
    } catch {
      // Element may be detached during provider swap.
    }
  }

  return { playAttempt }
}
