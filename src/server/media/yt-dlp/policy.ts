/**
 * Auto-derived yt-dlp knobs. Operators only set YTDLP_CACHE_TTL_SECONDS /
 * YTDLP_TIMEOUT_MS / YTDLP_MAX_CONCURRENT; everything else follows from those.
 */

/** Heights kept in the selectable progressive ladder (and format-sort target). */
export const PLAYBACK_LADDER_HEIGHTS = [360, 480, 720, 1080] as const

export const PLAYBACK_MAX_HEIGHT =
  PLAYBACK_LADDER_HEIGHTS[PLAYBACK_LADDER_HEIGHTS.length - 1]!

/**
 * How long cached stream/CDN URLs stay usable.
 * Derived from the Valkey extract TTL: fresher than the entry, capped for
 * typical signed-URL lifetimes, never exceeding the configured cache TTL.
 */
export function derivedStreamUrlMaxAgeSeconds(cacheTtlSeconds: number): number {
  if (cacheTtlSeconds <= 0) return 0
  const third = Math.floor(cacheTtlSeconds / 3)
  const comfortCap = 600
  const comfortFloor = 120
  return Math.min(
    cacheTtlSeconds,
    Math.min(comfortCap, Math.max(comfortFloor, third)),
  )
}

/**
 * Short lock TTL renewed by a heartbeat while yt-dlp runs.
 * Expiry = crash signal so another instance can acquire and redo the fetch.
 */
export function derivedLockHeartbeatTtlSeconds(timeoutMs: number): number {
  const halfTimeoutSec = Math.ceil(timeoutMs / 1000 / 2) + 5
  return Math.max(10, Math.min(30, halfTimeoutSec))
}

/** How long waiters keep polling cache / trying to acquire after a miss. */
export function derivedExtractFailoverWaitMs(timeoutMs: number): number {
  // Primary attempt + one failover extract + polling slack.
  return timeoutMs * 2 + 15_000
}

/** @deprecated use derivedLockHeartbeatTtlSeconds — kept for health alias */
export function derivedExtractLockTtlSeconds(timeoutMs: number): number {
  return derivedLockHeartbeatTtlSeconds(timeoutMs)
}

/** @deprecated use derivedExtractFailoverWaitMs */
export function derivedExtractLockWaitMs(
  timeoutMs: number,
  _lockTtlSeconds: number,
): number {
  return derivedExtractFailoverWaitMs(timeoutMs)
}

/** Playlist resolve lease heartbeat (same cadence as extract lock). */
export function derivedResolveLeaseTtlSeconds(timeoutMs: number): number {
  return derivedLockHeartbeatTtlSeconds(timeoutMs)
}

/** How often instances scan for abandoned playlist resolves. */
export function derivedResolveReclaimIntervalMs(timeoutMs: number): number {
  return Math.max(5_000, derivedLockHeartbeatTtlSeconds(timeoutMs) * 500)
}

/**
 * Prefer a bounded progressive/adaptive selection so top-level `url` /
 * `requested_formats` stay within our ladder. Full `formats[]` may still be
 * large; `--no-check-formats` is the main latency win.
 */
export function derivedYtDlpDumpArgs(sourceUrl: string): string[] {
  const maxH = PLAYBACK_MAX_HEIGHT
  return [
    "--no-playlist",
    "--no-check-formats",
    "-f",
    `bestvideo*[height<=${maxH}]+bestaudio/best[height<=${maxH}]/best`,
    "-S",
    `res:${maxH},+size,+br,codec:h264:vp9:av01,acodec:mp4a:opus`,
    "--dump-single-json",
    sourceUrl,
  ]
}
