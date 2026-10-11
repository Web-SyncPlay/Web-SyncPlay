import { isNativeProviderUrl } from "@/shared/player-utils"

/**
 * Optional per-provider overrides for the playback sync engine.
 *
 * Only native iframe providers (YouTube / Vimeo) resolve to a tuning object;
 * HLS / direct media returns `undefined` so the engine keeps its defaults.
 */
export type ProviderSyncTuning = {
  /** Anchor verify burst delays (ms). */
  retryDelaysMs?: readonly number[]
  /** Authority-pause nudge burst delays (ms). Defaults to `retryDelaysMs`. */
  pauseRetryDelaysMs?: readonly number[]
  /** Force-threshold seeks allowed per authority anchor. */
  maxForceSeeksPerAnchor?: number
}

/**
 * YouTube/Vimeo iframes apply seek/pause over postMessage, so the first
 * command is frequently dropped and `paused` lags behind. Compared with the
 * HLS schedule (200ms .. 6s) this one:
 *  - extends the tail to 9s/12s, so late joiners still converge while the
 *    iframe API boots and `canSeek` flips late;
 *  - starts pause nudges earlier (100ms) and repeats them on that same tail.
 */
export const IFRAME_RETRY_DELAYS_MS = [
  200, 600, 1_200, 2_400, 4_000, 6_000, 9_000, 12_000,
] as const

export const IFRAME_PAUSE_RETRY_DELAYS_MS = [
  100, ...IFRAME_RETRY_DELAYS_MS,
] as const

/** Iframe seeks are slower to land; allow a couple more hard seeks. */
export const IFRAME_MAX_FORCE_SEEKS_PER_ANCHOR = 8

export const IFRAME_PROVIDER_SYNC_TUNING: ProviderSyncTuning = {
  retryDelaysMs: IFRAME_RETRY_DELAYS_MS,
  pauseRetryDelaysMs: IFRAME_PAUSE_RETRY_DELAYS_MS,
  maxForceSeeksPerAnchor: IFRAME_MAX_FORCE_SEEKS_PER_ANCHOR,
}

/**
 * Resolve sync tuning from the active playback URL. Returns `undefined` for
 * non-iframe sources (HLS, direct files, blobs, relay URLs).
 */
export function resolveProviderSyncTuning(
  playbackSrc: string | null | undefined,
): ProviderSyncTuning | undefined {
  if (!playbackSrc || !isNativeProviderUrl(playbackSrc)) {
    return undefined
  }
  return IFRAME_PROVIDER_SYNC_TUNING
}
