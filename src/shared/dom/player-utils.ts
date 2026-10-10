/** Prefer a finite media-element seekable end over Vidstack's Infinity store. */
export function readMediaSeekableEndSec(
  media: Pick<HTMLMediaElement, "seekable"> | null | undefined,
): number | null {
  try {
    const ranges = media?.seekable
    if (!ranges || ranges.length === 0) {
      return null
    }
    const end = ranges.end(ranges.length - 1)
    return Number.isFinite(end) && end > 0 ? end : null
  } catch {
    return null
  }
}

export function queryPlayerMediaElement(
  root?: ParentNode | null,
): HTMLMediaElement | null {
  const scope = root ?? (typeof document !== "undefined" ? document : null)
  if (!scope) {
    return null
  }
  return (
    (scope.querySelector("video, audio") as HTMLMediaElement | null) ??
    (typeof document !== "undefined"
      ? (document.querySelector(
          "media-player video, media-player audio, [data-media-player] video, [data-media-player] audio, video, audio",
        ) as HTMLMediaElement | null)
      : null)
  )
}

/** Prefer the underlying media element playhead when the wrapper lags. */
export function readPlayerPlayheadSec(player: {
  el?: ParentNode | null
  currentTime?: number
}): number {
  const mediaEl = queryPlayerMediaElement(player.el)
  const mediaTime = Number(mediaEl?.currentTime)
  if (Number.isFinite(mediaTime)) {
    return mediaTime
  }
  return Number(player.currentTime ?? 0)
}

/**
 * Prefer a finite media-element seekable end; fall back to a player store value
 * (Vidstack often keeps Infinity for live HLS).
 */
export function readPlayerSeekableEndSec(player: {
  el?: ParentNode | null
  state?: { seekableEnd?: number }
  seekableEnd?: number
}): number | undefined {
  const mediaEl = queryPlayerMediaElement(player.el)
  const fromMedia = readMediaSeekableEndSec(mediaEl)
  if (fromMedia !== null) {
    return fromMedia
  }
  const fromState = Number(player.state?.seekableEnd ?? player.seekableEnd)
  return Number.isFinite(fromState) ? fromState : undefined
}
