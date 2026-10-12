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

function queryMediaInRoot(
  root: ParentNode | null | undefined,
): HTMLMediaElement | null {
  if (!root || !("querySelector" in root)) {
    return null
  }
  return root.querySelector("video, audio") as HTMLMediaElement | null
}

function queryMediaInShadowTree(scope: ParentNode): HTMLMediaElement | null {
  if (scope instanceof Element && scope.shadowRoot) {
    const fromShadow = queryMediaInRoot(scope.shadowRoot)
    if (fromShadow) {
      return fromShadow
    }
  }

  if (typeof scope.querySelectorAll !== "function") {
    return null
  }
  for (const child of Array.from(scope.querySelectorAll("*"))) {
    if (child instanceof Element && child.shadowRoot) {
      const nested = queryMediaInRoot(child.shadowRoot)
      if (nested) {
        return nested
      }
    }
  }
  return null
}

/**
 * Find the Vidstack-backed `<video>` / `<audio>`.
 *
 * When an explicit `root` is passed (including `null` / missing `player.el`),
 * search only that host + open shadow roots — never fall back to a document-
 * wide `video,audio` query, which can latch an unrelated element during
 * remounts. Omit `root` entirely only for legacy document-wide lookups.
 */
export function queryPlayerMediaElement(
  root?: ParentNode | null,
): HTMLMediaElement | null {
  const explicitRoot = arguments.length > 0
  if (explicitRoot && root == null) {
    return null
  }

  if (root) {
    const direct = queryMediaInRoot(root)
    if (direct) {
      return direct
    }
    return queryMediaInShadowTree(root)
  }

  if (typeof document === "undefined") {
    return null
  }
  return document.querySelector(
    "media-player video, media-player audio, [data-media-player] video, [data-media-player] audio, video, audio",
  ) as HTMLMediaElement | null
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
