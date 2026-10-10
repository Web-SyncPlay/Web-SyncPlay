export interface PlaybackSyncState {
  paused: boolean
  playbackRate: number
  timelineAnchorMs: number
  serverNowMs: number
}

/** Default absolute drift (seconds) before an authoritative clock seek. */
export const DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC = 0.8

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
): boolean {
  return Math.abs(currentSec - expectedSec) > thresholdSec
}

/**
 * Upper bound for authoritative seeks.
 *
 * Prefer the media seekable window end for live/DVR: `duration` often lags
 * behind the DVR edge, and clamping to it blocks Skip To Live / room sync.
 * Fall back to duration (minus a tiny EOF margin) for plain VOD.
 */
export function resolveSeekCeilingSec(input: {
  durationSec?: number | null
  seekableEndSec?: number | null
}): number | null {
  const seekableEnd = Number(input.seekableEndSec)
  if (Number.isFinite(seekableEnd) && seekableEnd > 0) {
    return Math.max(0, seekableEnd - 0.05)
  }
  const durationSec = Number(input.durationSec)
  if (Number.isFinite(durationSec) && durationSec > 0) {
    return Math.max(0, durationSec - 0.05)
  }
  return null
}

/**
 * Absolute drift between a local playhead and the room clock.
 * Returns `null` when either side is non-finite.
 */
export function measurePlaybackDriftSec(
  playerCurrentTimeSec: number,
  syncState: PlaybackSyncState,
  nowMs = Date.now(),
  durationSec?: number,
  seekableEndSec?: number,
): number | null {
  if (!Number.isFinite(playerCurrentTimeSec)) {
    return null
  }

  let expectedSec = computeExpectedPlaybackTimeSec(syncState, nowMs)
  const ceiling = resolveSeekCeilingSec({ durationSec, seekableEndSec })
  if (ceiling !== null) {
    expectedSec = Math.min(expectedSec, ceiling)
  }
  if (!Number.isFinite(expectedSec)) {
    return null
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
