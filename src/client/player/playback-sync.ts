export interface PlaybackSyncState {
  paused: boolean
  playbackRate: number
  timelineAnchorMs: number
  serverNowMs: number
}

/** Default absolute drift (seconds) before an authoritative clock seek. */
export const DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC = 0.8

/**
 * Playing force/late-join seek lead (HTML5 + native): write ahead of the room
 * clock so seek latency / post-seek buffering (~2–3s) does not leave the
 * playhead permanently behind. Soft (0.8) seeks do not add lead; paused seeks
 * never lead.
 */
export const FORCE_SEEK_LEAD_SEC = 2.5

/**
 * Local rate catch-up (non-native playing only): close mid-range lag without
 * another hard-seek/rebuffer cycle. Never written into room `playback:rate`.
 */
export const CATCH_UP_DRIFT_MIN_SEC = DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC
export const CATCH_UP_DRIFT_MAX_SEC = 3.0
/** Clear catch-up once absolute drift is at or below this. */
export const CATCH_UP_CLEAR_DRIFT_SEC = 0.35
export const CATCH_UP_RATE_BOOST = 1.4
export const CATCH_UP_RATE_MIN_FACTOR = 1.05
/** Allows ~1.4–1.5× room rate; still clamped by `PLAYBACK_RATE_SCHEMA_MAX`. */
export const CATCH_UP_RATE_MAX_FACTOR = 1.5
/** Matches `playbackRateSchema` absolute max. */
export const PLAYBACK_RATE_SCHEMA_MAX = 3

/** True when drift is in the catch-up band `(min, max]`. */
export function isCatchUpDriftBand(driftSec: number): boolean {
  return (
    Number.isFinite(driftSec) &&
    driftSec > CATCH_UP_DRIFT_MIN_SEC &&
    driftSec <= CATCH_UP_DRIFT_MAX_SEC
  )
}

/**
 * Temporary local playback rate to close mid-range lag, or `null` when the
 * drift is outside the catch-up band / room rate is unusable.
 */
export function resolveCatchUpPlaybackRate(
  roomRate: number,
  driftSec: number,
): number | null {
  if (!isCatchUpDriftBand(driftSec)) {
    return null
  }
  if (!Number.isFinite(roomRate) || roomRate <= 0) {
    return null
  }
  const boosted = roomRate * CATCH_UP_RATE_BOOST
  const lo = roomRate * CATCH_UP_RATE_MIN_FACTOR
  const hi = Math.min(
    roomRate * CATCH_UP_RATE_MAX_FACTOR,
    PLAYBACK_RATE_SCHEMA_MAX,
  )
  return Math.min(hi, Math.max(lo, boosted))
}

export function computeExpectedPlaybackTimeSec(
  syncState: PlaybackSyncState,
  nowMs = Date.now(),
): number {
  const anchorSec = Math.max(0, syncState.timelineAnchorMs / 1000)
  const elapsedSec = syncState.paused
    ? 0
    : Math.max(0, (nowMs - syncState.serverNowMs) / 1000)
  return anchorSec + elapsedSec * syncState.playbackRate
}

export function isPlaybackDriftBeyondThreshold(
  currentSec: number,
  expectedSec: number,
  thresholdSec: number,
  allowAheadSec = 0,
): boolean {
  if (
    allowAheadSec > 0 &&
    Number.isFinite(currentSec) &&
    Number.isFinite(expectedSec)
  ) {
    const ahead = currentSec - expectedSec
    if (ahead >= 0 && ahead <= allowAheadSec) {
      return false
    }
  }
  return Math.abs(currentSec - expectedSec) > thresholdSec
}

/** Provider duration/hint within this of seekableEnd may be buffer-only. */
export const BUFFER_ONLY_PROXIMITY_SEC = 1.0
/**
 * Absolute upper bound for buffer-as-duration distrust. Full VOD where
 * `duration === seekableEnd` (e.g. progressive MP4) is typically much larger
 * than an HLS buffered window and must stay trusted.
 */
export const BUFFER_ONLY_MAX_ABS_SEC = 45
/** EOF / seek ceiling leave this much headroom so providers don't restart. */
export const SEEK_CEILING_EPS_SEC = 0.05

/**
 * True when a duration/hint collapses to the buffered seekable window.
 * Requires both proximity to `seekableEnd` and a small absolute size so
 * fully-seekable long VOD is not treated as an HLS buffer blip.
 */
export function looksLikeBufferOnlyBound(
  boundSec: number | null,
  seekableEndSec: number | null,
): boolean {
  if (
    boundSec === null ||
    seekableEndSec === null ||
    !Number.isFinite(boundSec) ||
    !Number.isFinite(seekableEndSec)
  ) {
    return false
  }
  if (Math.abs(boundSec - seekableEndSec) >= BUFFER_ONLY_PROXIMITY_SEC) {
    return false
  }
  return Math.min(boundSec, seekableEndSec) < BUFFER_ONLY_MAX_ABS_SEC
}

/**
 * Upper bound for authoritative seeks (write clamp only).
 *
 * - Trusted finite VOD duration / catalog hint: ceiling is
 *   `max(trustedDuration, trustedHint, seekableEnd)` so a short buffered
 *   `seekable` range cannot clamp room seeks.
 * - Provider duration ≈ seekableEnd, or hint ≈ seekableEnd: ignore that bound
 *   (HLS/SoundCloud buffer-as-duration / poisoned catalog samples).
 * - Catalog live (`isLive`): use seekableEnd (DVR edge).
 * - False-live HLS / seekable-only unknown VOD: **no ceiling** — write the
 *   authority clock and let the provider extend the buffer.
 */
export function resolveSeekCeilingSec(input: {
  durationSec?: number | null
  seekableEndSec?: number | null
  /** Catalog / playlist duration when the provider reports 0 / NaN / Infinity. */
  durationHintSec?: number | null
  /** Catalog live flag — not the same as provider `duration === Infinity`. */
  isLive?: boolean
}): number | null {
  const seekableEnd = Number(input.seekableEndSec)
  const durationSec = Number(input.durationSec)
  const hintSec = Number(input.durationHintSec)
  const finiteSeekable =
    Number.isFinite(seekableEnd) && seekableEnd > 0 ? seekableEnd : null
  const finiteDuration =
    Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null
  const finiteHint =
    Number.isFinite(hintSec) && hintSec > 0 ? hintSec : null

  // Ignore bounds that collapse to the buffered window (with or without a
  // catalog hint — a poisoned hint≈seekable must not create a fake ceiling).
  const trustedDuration = looksLikeBufferOnlyBound(
    finiteDuration,
    finiteSeekable,
  )
    ? null
    : finiteDuration
  const trustedHint = looksLikeBufferOnlyBound(finiteHint, finiteSeekable)
    ? null
    : finiteHint
  const vodBound = Math.max(trustedDuration ?? 0, trustedHint ?? 0)
  if (vodBound > 0) {
    const withSeekable =
      finiteSeekable !== null ? Math.max(vodBound, finiteSeekable) : vodBound
    return Math.max(0, withSeekable - SEEK_CEILING_EPS_SEC)
  }

  if (input.isLive === true && finiteSeekable !== null) {
    return Math.max(0, finiteSeekable - SEEK_CEILING_EPS_SEC)
  }

  return null
}

/**
 * Absolute drift between a local playhead and the room clock.
 * Convergence uses the **unclamped** expected time so a short/poisoned seek
 * ceiling cannot false-clear pending. Returns `null` when unmeasurable.
 *
 * EOF exception: when a *trusted* ceiling exists (non-null from
 * `resolveSeekCeilingSec`) and the playhead is already at that ceiling while
 * the room clock is past it, treat as converged.
 */
export function measurePlaybackDriftSec(
  playerCurrentTimeSec: number,
  syncState: PlaybackSyncState,
  nowMs = Date.now(),
  durationSec?: number,
  seekableEndSec?: number,
  durationHintSec?: number | null,
  isLive?: boolean,
  /**
   * When > 0, playhead ahead of the room clock by at most this many seconds
   * counts as converged (playing force-seek lead band).
   */
  allowAheadSec = 0,
): number | null {
  if (!Number.isFinite(playerCurrentTimeSec)) {
    return null
  }

  const expectedSec = computeExpectedPlaybackTimeSec(syncState, nowMs)
  if (!Number.isFinite(expectedSec)) {
    return null
  }

  const ceiling = resolveSeekCeilingSec({
    durationSec,
    seekableEndSec,
    durationHintSec,
    isLive,
  })
  // Trusted ceiling + playhead at media end while room is past EOF → converged.
  // Buffer-only ceilings return null above, so a stuck ~5s playhead vs room 20
  // keeps a large unclamped drift and does not clear.
  if (
    ceiling !== null &&
    expectedSec > ceiling &&
    Math.abs(playerCurrentTimeSec - ceiling) <=
      DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC
  ) {
    return Math.abs(playerCurrentTimeSec - ceiling)
  }

  if (allowAheadSec > 0) {
    const ahead = playerCurrentTimeSec - expectedSec
    if (ahead >= 0 && ahead <= allowAheadSec) {
      return 0
    }
  }

  return Math.abs(playerCurrentTimeSec - expectedSec)
}

export function inferMediaViewType(url?: string): "audio" | "video" {
  if (!url) {
    return "video"
  }

  const lower = url.toLowerCase()
  if (/\.(mp3|wav|ogg|flac|m4a|aac)(\?|$)/.test(lower)) {
    return "audio"
  }
  return "video"
}

export function getAdjacentPlaylistIndex(config: {
  currentIndex: number
  totalItems: number
  loopMode: "off" | "once" | "always"
  direction: "previous" | "next"
}): number | null {
  const { currentIndex, totalItems, loopMode, direction } = config
  if (totalItems <= 0) {
    return null
  }
  const canWrap = loopMode !== "off"
  if (direction === "previous") {
    if (currentIndex > 0) {
      return currentIndex - 1
    }
    return canWrap ? totalItems - 1 : null
  }
  if (currentIndex < totalItems - 1) {
    return currentIndex + 1
  }
  return canWrap ? 0 : null
}
