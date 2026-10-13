import type { ParticipantLocalPlayback } from "@/contracts/types"

/**
 * Smooth peer-facing playhead between sparse presence samples.
 *
 * When a report is playing and ready, advance from `currentTimeMs` by wall-clock
 * age since `updatedAt` (× rate). Paused / loading / error samples stay frozen
 * so we do not invent progress for a stalled background tab.
 */
export function extrapolateLocalPlaybackTimeMs(
  playback: Pick<
    ParticipantLocalPlayback,
    "paused" | "loading" | "currentTimeMs" | "updatedAt" | "error"
  >,
  nowMs: number,
  options?: {
    playbackRate?: number
    /** Cap extrapolated time (e.g. catalog/media duration). */
    durationMs?: number | null
  },
): number {
  const sampleMs = Math.max(0, Number(playback.currentTimeMs) || 0)
  if (
    playback.paused ||
    playback.loading ||
    playback.error ||
    !Number.isFinite(playback.updatedAt)
  ) {
    return sampleMs
  }

  const rate =
    typeof options?.playbackRate === "number" &&
    Number.isFinite(options.playbackRate) &&
    options.playbackRate > 0
      ? options.playbackRate
      : 1
  const ageMs = Math.max(0, nowMs - playback.updatedAt)
  let displayMs = sampleMs + ageMs * rate

  const durationMs = options?.durationMs
  if (
    typeof durationMs === "number" &&
    Number.isFinite(durationMs) &&
    durationMs > 0
  ) {
    displayMs = Math.min(displayMs, durationMs)
  }

  return Math.max(0, Math.floor(displayMs))
}

/** True when the row clock should tick locally between presence batches. */
export function shouldExtrapolateLocalPlayback(
  playback: Pick<ParticipantLocalPlayback, "paused" | "loading" | "error">,
): boolean {
  return !playback.paused && !playback.loading && !playback.error
}
