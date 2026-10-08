/**
 * Jellyfin / Emby playback URL helpers (pure; safe for client + server).
 *
 * Bare media-server HLS often remuxes library codecs (e.g. HEVC) that browsers
 * cannot decode. We reshape HLS query params toward H.264/AAC TS segments.
 */

export const UNSUPPORTED_MPEG_TS_PROGRESSIVE_MESSAGE =
  "Progressive MPEG-TS / m2ts streams are not browser-playable. Use an HLS URL (main.m3u8 or master.m3u8) or an mp4 file instead."

/** Path/query heuristics — not hostname allowlists. */
export function looksLikeJellyfinEmbyPlaybackUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    const path = url.pathname.toLowerCase()
    if (!/\/videos\//i.test(path) && !/\/audio\//i.test(path)) {
      return false
    }
    if (/\.(m3u8)(\/|$)/i.test(path)) return true
    if (/\/(main|master|live)\.m3u8$/i.test(path)) return true
    if (/\/stream(\.[a-z0-9]+)?$/i.test(path)) return true
    if (url.searchParams.has("MediaSourceId") || url.searchParams.has("mediaSourceId")) {
      return true
    }
    if (url.searchParams.has("api_key") || url.searchParams.has("ApiKey")) {
      return /\.(m3u8)$/i.test(path) || /\/stream/i.test(path)
    }
    return false
  } catch {
    return false
  }
}

export function isJellyfinEmbyHlsUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    const path = url.pathname.toLowerCase()
    if (!looksLikeJellyfinEmbyPlaybackUrl(rawUrl)) return false
    return /\.m3u8$/i.test(path) || path.includes(".m3u8")
  } catch {
    return false
  }
}

/**
 * Progressive MPEG-TS top-level playback (not HLS segments inside a playlist).
 * Browsers cannot play these as a media element source.
 */
export function isUnsupportedMpegTsProgressiveUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    const path = url.pathname.toLowerCase()
    if (/\.m3u8$/i.test(path) || path.includes(".m3u8")) {
      return false
    }
    if (/\.(m2ts|mts|ts)$/i.test(path)) {
      return true
    }
    const container = (
      url.searchParams.get("container") ??
      url.searchParams.get("Container") ??
      ""
    ).toLowerCase()
    if (
      /\/stream(\.[a-z0-9]+)?$/i.test(path) &&
      (container === "m2ts" || container === "ts" || container === "mpegts")
    ) {
      return true
    }
    return false
  } catch {
    return false
  }
}

const BROWSER_SAFE_HLS_PARAMS: Record<string, string> = {
  VideoCodec: "h264",
  AudioCodec: "aac",
  EnableAutoStreamCopy: "false",
  AllowVideoStreamCopy: "false",
  AllowAudioStreamCopy: "false",
  enableMpegtsM2TsMode: "false",
  SegmentContainer: "ts",
}

/** Case-insensitive query key set/replace. */
function setQueryParam(url: URL, key: string, value: string) {
  const lower = key.toLowerCase()
  const existing: string[] = []
  url.searchParams.forEach((_, name) => {
    if (name.toLowerCase() === lower) existing.push(name)
  })
  for (const name of existing) {
    url.searchParams.delete(name)
  }
  url.searchParams.set(key, value)
}

/**
 * Force browser-safe remux/transcode for Jellyfin/Emby HLS playlists.
 * Non-matching URLs are returned unchanged.
 */
export function shapeJellyfinEmbyHlsUrl(rawUrl: string): string {
  if (!isJellyfinEmbyHlsUrl(rawUrl)) {
    return rawUrl
  }
  try {
    const url = new URL(rawUrl)
    for (const [key, value] of Object.entries(BROWSER_SAFE_HLS_PARAMS)) {
      setQueryParam(url, key, value)
    }
    return url.toString()
  } catch {
    return rawUrl
  }
}
