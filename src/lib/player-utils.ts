export const directMediaPattern =
  /\.(mp4|webm|m3u8|mpd|mp3|ogg|wav|flac|m4a|aac|weba|m4v|mov|ogv|ts|m2ts)(\?|$)/i

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
