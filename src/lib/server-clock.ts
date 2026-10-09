/**
 * Client estimate of server wall time for playback projection.
 * Updated from room snapshots / control payloads that carry `serverNowMs`.
 */

let serverOffsetMs = 0
let hasSample = false

export function getServerClockOffsetMs(): number {
  return serverOffsetMs
}

export function setServerClockOffsetMs(offsetMs: number): void {
  serverOffsetMs = Number.isFinite(offsetMs) ? offsetMs : 0
  hasSample = true
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

/** Blend a fresh server stamp into the running offset (EMA). */
export function observeServerNowMs(
  serverNowMs: number,
  clientNowMs = Date.now(),
  rttMs = 0,
): number {
  if (!Number.isFinite(serverNowMs)) {
    return serverOffsetMs
  }
  const sample = estimateServerClockOffsetMs(serverNowMs, clientNowMs, rttMs)
  if (!hasSample) {
    serverOffsetMs = sample
    hasSample = true
  } else {
    serverOffsetMs = serverOffsetMs * 0.8 + sample * 0.2
  }
  return serverOffsetMs
}

/** Test helper — reset module state. */
export function resetServerClockOffsetForTests(): void {
  serverOffsetMs = 0
  hasSample = false
}
