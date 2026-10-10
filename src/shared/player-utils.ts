/** Browser-playable direct media extensions (not progressive MPEG-TS). */
export const directMediaPattern =
  /\.(mp4|webm|m3u8|mpd|mp3|ogg|wav|flac|m4a|aac|weba|m4v|mov|ogv)(\?|$)/i

export const nativeProviderHosts = [
  "youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "vimeo.com",
] as const

export type PlayerStreamType = "live" | "on-demand"

export function isNativeProviderUrl(rawUrl: string) {
  try {
    const { hostname } = new URL(rawUrl)
    const host = hostname.toLowerCase()
    return nativeProviderHosts.some(
      (allowedHost) => host === allowedHost || host.endsWith(`.${allowedHost}`),
    )
  } catch {
    return false
  }
}

export function canPlayNatively(rawUrl: string) {
  return directMediaPattern.test(rawUrl) || isNativeProviderUrl(rawUrl)
}

/**
 * Vidstack/hls.js often marks catch-up HLS (no EXT-X-ENDLIST) as `live`, which
 * sets `canSeek=false` and disables scrubbing. For SyncPlay VOD we must force
 * on-demand unless the catalog item is explicitly live.
 */
export function resolvePlayerStreamType(item?: {
  isLive?: boolean
}): PlayerStreamType {
  return item?.isLive === true ? "live" : "on-demand"
}

/**
 * Provide catalog duration so Vidstack's `canSeek` sees a finite length even
 * when the HLS provider reports `Infinity` under a false-live playlist.
 */
export function resolvePlayerDurationSec(item?: {
  isLive?: boolean
  durationSeconds?: number
}): number | undefined {
  if (item?.isLive === true) {
    return undefined
  }
  const durationSec = Number(item?.durationSeconds)
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return undefined
  }
  return durationSec
}

/**
 * Resolve a seek target near the live edge.
 *
 * Prefer the media seekable window end (minus a small safety margin). HLS
 * `liveSyncPosition` is often stale or far behind the DVR edge for proxied
 * Twitch/live streams, so only fall back to it when seekableEnd is unusable.
 * Returns null when no usable live edge is available.
 */
export function resolveLiveEdgeSec(input: {
  seekableEnd?: number | null
  liveSyncPosition?: number | null
}): number | null {
  const seekableEnd = Number(input.seekableEnd)
  const liveSync = Number(input.liveSyncPosition)
  const fromSeekable =
    Number.isFinite(seekableEnd) && seekableEnd > 0 ? seekableEnd - 2 : null
  const fromLiveSync =
    Number.isFinite(liveSync) && liveSync > 0 ? liveSync : null

  if (fromSeekable !== null) {
    // Clamp liveSync when it is ahead of the seekable window; otherwise trust
    // seekableEnd so Skip To Live actually reaches the DVR edge.
    if (fromLiveSync !== null && fromLiveSync > fromSeekable) {
      return Math.max(0, fromSeekable)
    }
    return Math.max(0, fromSeekable)
  }
  if (fromLiveSync !== null) {
    return Math.max(0, fromLiveSync)
  }
  return null
}
