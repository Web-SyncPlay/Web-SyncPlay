/**
 * Lightweight server clock offset tracker for audit scripts (mirrors @/shared/server-clock).
 * Updated from room payloads that carry `serverNowMs`.
 */

export type ServerClockEstimate = {
  observeServerNowMs: (serverNowMs: number, clientNowMs?: number) => void
  serverNowEstimateMs: (clientNowMs?: number) => number
  hasSample: () => boolean
}

export function createServerClockEstimate(): ServerClockEstimate {
  let serverOffsetMs = 0
  let sampled = false

  return {
    observeServerNowMs(serverNowMs, clientNowMs = Date.now()) {
      if (!Number.isFinite(serverNowMs)) return
      serverOffsetMs = serverNowMs - clientNowMs
      sampled = true
    },
    serverNowEstimateMs(clientNowMs = Date.now()) {
      return clientNowMs + serverOffsetMs
    },
    hasSample() {
      return sampled
    },
  }
}

export type PlaybackClockFields = {
  paused?: boolean
  playbackRate?: number
  timelineAnchorMs?: number
  serverNowMs?: number
}

/** Expected playhead (seconds) from room playback anchor + estimated server now. */
export function expectedPlayheadSec(
  pb: PlaybackClockFields,
  serverNowEstimateMs: (now?: number) => number,
): number | null {
  if (
    typeof pb.timelineAnchorMs !== "number" ||
    typeof pb.serverNowMs !== "number"
  ) {
    return null
  }
  const anchorSec = pb.timelineAnchorMs / 1000
  if (pb.paused) return anchorSec
  const elapsedSec = Math.max(0, serverNowEstimateMs() - pb.serverNowMs) / 1000
  return anchorSec + elapsedSec * (pb.playbackRate ?? 1)
}
