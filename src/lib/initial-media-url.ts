/** First non-empty `?media=` query value (raw; may be unsupported). */
export function readMediaQueryParam(
  raw: string | string[] | undefined,
): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw
  const trimmed = value?.trim()
  return trimmed || undefined
}

/** Parse create-time `?media=` seed; http(s) only. */
export function parseInitialMediaUrl(
  raw: string | string[] | undefined,
): string | undefined {
  const value = readMediaQueryParam(raw)
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    return url.href
  } catch {
    return undefined
  }
}
