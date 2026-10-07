/**
 * Pure byte-Range header parsing shared by HTTP routes and the local-media SW.
 */

export type RawBytesRange = { start: number; end: number | null }

export type ResolvedBytesRange =
  | { invalid: true }
  | { start: number; end: number }

/**
 * Parse a single `bytes=start-end` Range header without clamping to a length.
 * Returns null when the header is absent or not a simple bytes range.
 * `end` is null for open-ended ranges (`bytes=100-`).
 */
export function parseRawBytesRangeHeader(
  rangeHeader: string | null,
): RawBytesRange | null {
  if (!rangeHeader) {
    return null
  }
  const match = /^bytes=(\d+)-(\d+)?$/i.exec(rangeHeader.trim())
  if (!match) {
    return null
  }
  const start = Number.parseInt(match[1] ?? "0", 10)
  const end =
    match[2] != null ? Number.parseInt(match[2], 10) : null
  if (!Number.isFinite(start) || (end != null && !Number.isFinite(end))) {
    return null
  }
  return { start, end }
}

/** Clamp a raw range against a known total length (inclusive end). */
export function resolveBytesRangeAgainstLength(
  range: RawBytesRange,
  totalLength: number,
): ResolvedBytesRange {
  const end = range.end ?? totalLength - 1
  if (range.start < 0 || end < range.start || range.start >= totalLength) {
    return { invalid: true }
  }
  return {
    start: range.start,
    end: Math.min(end, totalLength - 1),
  }
}

/**
 * Parse a Range header against a known total length.
 * Returns null when the header is absent (full-resource request).
 */
export function parseLocalMediaRangeHeader(
  rangeHeader: string | null,
  totalLength: number,
): ResolvedBytesRange | null {
  const raw = parseRawBytesRangeHeader(rangeHeader)
  if (!raw) {
    return null
  }
  return resolveBytesRangeAgainstLength(raw, totalLength)
}
