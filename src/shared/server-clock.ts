/**
 * Client estimate of server wall time for playback projection.
 * Updated only from true send-time wall stamps (`serverWallNowMs`,
 * `presence:batch.serverNowMs`, `session:clock`) — never from the frozen
 * playback timeline stamp (`playback.serverNowMs`).
 */

let serverOffsetMs = 0
let hasSample = false
/** Last measured WS RTT (ms); used for half-RTT correction + drift threshold. */
let lastRttMs = 0

/** Reject EMA samples that would jump the offset by more than this. */
export const SERVER_CLOCK_OFFSET_OUTLIER_MS = 10_000

export function setServerClockOffsetMs(offsetMs: number): void {
  serverOffsetMs = Number.isFinite(offsetMs) ? offsetMs : 0
  hasSample = true
}

export function getServerClockOffsetMs(): number {
  return serverOffsetMs
}

export function getLastRttMs(): number {
  return lastRttMs
}

/** Record a fresh RTT sample (EMA-blended once we have one). */
export function observeRttMs(rttMs: number): number {
  if (!Number.isFinite(rttMs) || rttMs < 0) {
    return lastRttMs
  }
  if (lastRttMs <= 0) {
    lastRttMs = rttMs
  } else {
    lastRttMs = lastRttMs * 0.7 + rttMs * 0.3
  }
  return lastRttMs
}

/**
 * Estimate offset so `Date.now() + offset ≈ serverNow`.
 * Optional `rttMs` applies classic NTP half-RTT correction when known.
 */
export function estimateServerClockOffsetMs(
  serverNowMs: number,
  clientNowMs = Date.now(),
  rttMs = 0,
): number {
  const halfRtt = Number.isFinite(rttMs) && rttMs > 0 ? rttMs / 2 : 0
  return serverNowMs + halfRtt - clientNowMs
}

/** Wall time on the server clock for drift / expected-playhead math. */
export function serverNowEstimateMs(clientNowMs = Date.now()): number {
  return clientNowMs + serverOffsetMs
}

/**
 * Blend a fresh server wall stamp into the running offset (EMA).
 * Uses `rttMs` when provided, otherwise the last observed RTT.
 * Outlier samples (jump > {@link SERVER_CLOCK_OFFSET_OUTLIER_MS}) are ignored
 * after the first seed so a single bad stamp cannot yank the estimate.
 */
export function observeServerNowMs(
  serverNowMs: number,
  clientNowMs = Date.now(),
  rttMs?: number,
): number {
  if (!Number.isFinite(serverNowMs)) {
    return serverOffsetMs
  }
  const effectiveRtt =
    rttMs !== undefined && Number.isFinite(rttMs) && rttMs > 0
      ? rttMs
      : lastRttMs
  if (rttMs !== undefined && Number.isFinite(rttMs) && rttMs > 0) {
    observeRttMs(rttMs)
  }
  const sample = estimateServerClockOffsetMs(
    serverNowMs,
    clientNowMs,
    effectiveRtt,
  )
  if (!hasSample) {
    serverOffsetMs = sample
    hasSample = true
  } else if (
    Math.abs(sample - serverOffsetMs) > SERVER_CLOCK_OFFSET_OUTLIER_MS
  ) {
    // Keep prior estimate; do not poison EMA with a pathological sample.
    return serverOffsetMs
  } else {
    serverOffsetMs = serverOffsetMs * 0.8 + sample * 0.2
  }
  return serverOffsetMs
}

/** Test helper — reset module state. */
export function resetServerClockOffsetForTests(): void {
  serverOffsetMs = 0
  hasSample = false
  lastRttMs = 0
}
