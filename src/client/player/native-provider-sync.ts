/**
 * Pure helpers for YouTube / Vimeo (native iframe) room sync.
 *
 * Iframe embeds apply seek/pause over postMessage. The Vidstack wrapper's
 * `currentTime` / `paused` can report the *requested* value immediately while
 * the embed keeps playing from the old position, so "drift ≤ threshold right
 * after the write" is not proof of convergence. The tracker below keeps
 * `pendingSync` alive until the playhead is observed moving toward the target
 * on a later read (or a bounded number of consecutive verify failures).
 */

/** Consecutive failed verifications before native pending is released. */
export const NATIVE_MAX_VERIFY_FAILURES = 6
/** A seek write is not confirmable in the same tick (wrapper echoes target). */
export const NATIVE_MIN_CONFIRM_MS = 100
/** Playhead must close the gap to the target by at least this much. */
export const NATIVE_MOVE_TOWARD_EPSILON_SEC = 0.25
/** Playing-room playhead must advance at least this much between samples. */
export const NATIVE_STALE_EPSILON_SEC = 0.05
/** Paused room: playhead drift beyond this between samples means still playing. */
export const NATIVE_QUIESCE_EPSILON_SEC = 0.35
/** Ignore samples closer together than this (too small to judge motion). */
export const NATIVE_MIN_SAMPLE_GAP_MS = 150
/**
 * Pause quiescence needs a wider gap than seek stale detection: iframe
 * providers often expose 1Hz integer `currentTime`, so two reads 150ms apart
 * can both report the same second while the embed is still playing.
 */
export const NATIVE_PAUSE_MIN_SAMPLE_GAP_MS = 1_500
/** Stable samples required before a paused provider counts as quiescent. */
export const NATIVE_QUIESCENT_SAMPLES = 2

/**
 * Duration gate: aggressive sync (hard seeks) waits for a positive duration.
 * `Infinity` is accepted (live) — only `NaN` / `<= 0` / missing blocks.
 */
export function isNativeDurationReady(input: {
  playerDurationSec?: number | null
  hintDurationSec?: number | null
}): boolean {
  for (const raw of [input.playerDurationSec, input.hintDurationSec]) {
    const value = Number(raw)
    if (!Number.isNaN(value) && value > 0) {
      return true
    }
  }
  return false
}

/** True when `currentSec` is meaningfully closer to `targetSec` than `fromSec`. */
export function hasPlayheadMovedToward(input: {
  fromSec: number
  currentSec: number
  targetSec: number
  epsilonSec?: number
}): boolean {
  const epsilon = input.epsilonSec ?? NATIVE_MOVE_TOWARD_EPSILON_SEC
  if (
    !Number.isFinite(input.fromSec) ||
    !Number.isFinite(input.currentSec) ||
    !Number.isFinite(input.targetSec)
  ) {
    return false
  }
  const before = Math.abs(input.fromSec - input.targetSec)
  const after = Math.abs(input.currentSec - input.targetSec)
  return before - after >= epsilon
}

type SeekProbe = {
  anchorMs: number
  fromSec: number
  targetSec: number
  writtenAtMs: number
  lastSampleSec: number
  lastSampleAtMs: number
  /** Playing confirm: prior sample was already within room-drift threshold. */
  lastNearRoom: boolean
}

export type NativeSeekVerdict =
  /** No outstanding native seek — caller uses its normal rules. */
  | "none"
  /** Keep pendingSync; playhead not yet confirmed. */
  | "pending"
  /** Playhead moved toward target and is within threshold. */
  | "confirmed"
  /** Too many consecutive failures — release pending. */
  | "gave-up"

export type NativeSyncTracker = {
  reset: () => void
  /** Record a seek write (`fromSec` is the playhead *before* the write). */
  noteSeek: (input: {
    anchorMs: number
    fromSec: number
    targetSec: number
    nowMs: number
  }) => void
  hasSeekProbe: () => boolean
  /** Judge an outstanding seek on a later read. */
  evaluateSeek: (input: {
    anchorMs: number
    currentSec: number
    driftSec: number | null
    thresholdSec: number
    roomPaused: boolean
    nowMs: number
  }) => NativeSeekVerdict
  /**
   * Sample the playhead of a paused room. Returns true once the provider is
   * quiescent (paused flag stable and playhead not advancing), or the failure
   * budget is spent.
   */
  samplePauseQuiescence: (input: {
    currentSec: number
    wrapperPaused: boolean | undefined
    nowMs: number
  }) => { quiescent: boolean; sampled: boolean }
  /** Forget pause samples (room resumed / new pause cycle). */
  resetPauseSamples: () => void
  /** Whether a threshold-0 pause seek was already issued for this key. */
  claimPauseSeek: (key: string) => boolean
}

export function createNativeSyncTracker(): NativeSyncTracker {
  let probe: SeekProbe | null = null
  let seekFailures = 0
  let pauseSample: { sec: number; atMs: number } | null = null
  let stableSamples = 0
  let pauseFailures = 0
  /** Sticky until motion is seen again or samples reset. */
  let pauseSettled = false
  let pauseSeekKey: string | null = null

  const resetPauseSamples = () => {
    pauseSample = null
    stableSamples = 0
    pauseFailures = 0
    pauseSettled = false
  }

  return {
    reset: () => {
      probe = null
      seekFailures = 0
      pauseSeekKey = null
      resetPauseSamples()
    },
    noteSeek: ({ anchorMs, fromSec, targetSec, nowMs }) => {
      // A seek write legitimately jumps the playhead; restart pause sampling.
      resetPauseSamples()
      if (probe && probe.anchorMs === anchorMs) {
        // Retry write for the same anchor: keep the original baseline so a
        // wrapper that echoes `targetSec` cannot reset "moved toward".
        probe = {
          ...probe,
          targetSec,
          writtenAtMs: nowMs,
          lastNearRoom: false,
        }
        return
      }
      probe = {
        anchorMs,
        fromSec,
        targetSec,
        writtenAtMs: nowMs,
        lastSampleSec: fromSec,
        lastSampleAtMs: nowMs,
        lastNearRoom: false,
      }
      seekFailures = 0
    },
    hasSeekProbe: () => probe !== null,
    evaluateSeek: ({
      anchorMs,
      currentSec,
      driftSec,
      thresholdSec,
      roomPaused,
      nowMs,
    }) => {
      if (!probe) {
        return "none"
      }
      if (probe.anchorMs !== anchorMs) {
        // Superseded by a newer authority anchor.
        probe = null
        seekFailures = 0
        return "none"
      }
      const fail = (): NativeSeekVerdict => {
        seekFailures += 1
        if (seekFailures >= NATIVE_MAX_VERIFY_FAILURES) {
          probe = null
          seekFailures = 0
          return "gave-up"
        }
        return "pending"
      }
      if (driftSec === null || driftSec > thresholdSec) {
        probe.lastSampleSec = currentSec
        probe.lastSampleAtMs = nowMs
        return fail()
      }
      if (nowMs - probe.writtenAtMs < NATIVE_MIN_CONFIRM_MS) {
        return "pending"
      }

      // Playing rooms: drift ≤ threshold already means "near room". Confirm
      // only after a later sample advances from a prior near-room read so a
      // frozen dual-echo cannot clear pending while the room clock moves.
      // Do not key off static probe.targetSec (room expected advances).
      if (!roomPaused) {
        const sampleGapOk =
          nowMs - probe.lastSampleAtMs >= NATIVE_MIN_SAMPLE_GAP_MS
        const advanced =
          Math.abs(currentSec - probe.lastSampleSec) >= NATIVE_STALE_EPSILON_SEC
        const wasNearRoom = probe.lastNearRoom
        probe.lastSampleSec = currentSec
        probe.lastSampleAtMs = nowMs
        probe.lastNearRoom = true
        if (wasNearRoom && advanced) {
          probe = null
          seekFailures = 0
          return "confirmed"
        }
        if (wasNearRoom && sampleGapOk && !advanced) {
          return fail()
        }
        // First near-room sample (echo) or gap too small — keep pending.
        return "pending"
      }

      const moved = hasPlayheadMovedToward({
        fromSec: probe.fromSec,
        currentSec,
        targetSec: probe.targetSec,
      })
      const stale =
        !moved &&
        nowMs - probe.lastSampleAtMs >= NATIVE_MIN_SAMPLE_GAP_MS &&
        Math.abs(currentSec - probe.lastSampleSec) < NATIVE_STALE_EPSILON_SEC
      probe.lastSampleSec = currentSec
      probe.lastSampleAtMs = nowMs
      if (!moved && stale) {
        return fail()
      }
      // Paused: not "moved" only for tiny seeks whose baseline was already
      // near the target; a later read inside the threshold is then enough.
      probe = null
      seekFailures = 0
      return "confirmed"
    },
    samplePauseQuiescence: ({ currentSec, wrapperPaused, nowMs }) => {
      if (!Number.isFinite(currentSec)) {
        return { quiescent: false, sampled: false }
      }
      if (pauseSample === null) {
        pauseSample = { sec: currentSec, atMs: nowMs }
        stableSamples = 0
        return { quiescent: false, sampled: true }
      }
      if (nowMs - pauseSample.atMs < NATIVE_PAUSE_MIN_SAMPLE_GAP_MS) {
        // Too close to judge: keep the last verdict so two schedulers
        // (pause burst + verify tick) sharing one clock cannot starve it.
        return { quiescent: pauseSettled, sampled: false }
      }
      const moved =
        Math.abs(currentSec - pauseSample.sec) > NATIVE_QUIESCE_EPSILON_SEC
      pauseSample = { sec: currentSec, atMs: nowMs }
      if (moved || wrapperPaused === false) {
        stableSamples = 0
        pauseSettled = false
        pauseFailures += 1
        if (pauseFailures >= NATIVE_MAX_VERIFY_FAILURES * 2) {
          // Give up holding pending; transport nudges keep running elsewhere.
          pauseSettled = true
          return { quiescent: true, sampled: true }
        }
        return { quiescent: false, sampled: true }
      }
      stableSamples += 1
      if (stableSamples >= NATIVE_QUIESCENT_SAMPLES - 1) {
        pauseFailures = 0
        pauseSettled = true
        return { quiescent: true, sampled: true }
      }
      return { quiescent: false, sampled: true }
    },
    resetPauseSamples,
    claimPauseSeek: (key) => {
      if (pauseSeekKey === key) {
        return false
      }
      pauseSeekKey = key
      return true
    },
  }
}
