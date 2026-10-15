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

/** Create-time `?local=1` — skip daily-default playlist seeding. */
export function readSkipDefaultMediaParam(
  raw: string | string[] | undefined,
): boolean {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "local"
  )
}
