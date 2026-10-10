/**
 * Catalog duration helpers. Unknown duration is `null` — never coerce to 0
 * for UI progress math (that makes scrubbers sit at 100%).
 */

export function resolveCatalogDurationSeconds(item?: {
  isLive?: boolean
  durationSeconds?: number
}): number | null {
  if (item?.isLive === true) {
    return null
  }
  const durationSec = Number(item?.durationSeconds)
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return null
  }
  return durationSec
}

export function resolveCatalogDurationMs(item?: {
  isLive?: boolean
  durationSeconds?: number
}): number | null {
  const durationSec = resolveCatalogDurationSeconds(item)
  if (durationSec === null) {
    return null
  }
  return Math.floor(durationSec * 1000)
}

/** Merge player-observed and catalog durations; `null` when both unknown. */
export function resolveEffectiveDurationMs(input: {
  mediaDurationMs?: number
  catalogDurationMs?: number | null
}): number | null {
  const media = Number(input.mediaDurationMs)
  const catalog = Number(input.catalogDurationMs)
  const mediaOk = Number.isFinite(media) && media > 0 ? media : null
  const catalogOk = Number.isFinite(catalog) && catalog > 0 ? catalog : null
  if (mediaOk === null && catalogOk === null) {
    return null
  }
  return Math.max(mediaOk ?? 0, catalogOk ?? 0)
}
