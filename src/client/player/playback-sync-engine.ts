import {
  applyPlaybackSyncToPlayer,
  nudgePlaybackTransport,
  type SyncablePlayer,
} from "@/client/player/apply-playback-sync"
import {
  DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
  measurePlaybackDriftSec,
  type PlaybackSyncState,
} from "@/client/player/playback-sync"
import { serverNowEstimateMs } from "@/shared/server-clock"

/** Single scheduler phases for room ↔ local playhead sync. */
export type PlaybackSyncPhase =
  | "idle"
  | "applying"
  | "verifying"
  | "holdingLocalSeek"

export const TRANSPORT_NUDGE_RETRY_MS = 350
export const WATCHDOG_INTERVAL_MS = 1_000
/** HLS often no-ops the first currentTime write; retry while the anchor is fresh. */
export const ANCHOR_RETRY_DELAYS_MS = [200, 600, 1_200, 2_400] as const
/** Cap force-threshold seeks per anchor to avoid HLS seek storms. */
export const MAX_FORCE_SEEKS_PER_ANCHOR = 4

export type EngineSyncState = PlaybackSyncState & {
  videoLoop: boolean
}

export type PlaybackSnapshot = {
  paused: boolean
  playbackRate: number
  timelineAnchorMs: number
  serverNowMs: number
  videoLoop: string | boolean
}

export type PlaybackSyncScheduler = {
  nowMs: () => number
  setTimeout: (fn: () => void, ms: number) => number
  clearTimeout: (id: number) => void
  setInterval: (fn: () => void, ms: number) => number
  clearInterval: (id: number) => void
}

export type PlaybackSyncEngineHost = {
  getPlayer: () => SyncablePlayer | null
  isMediaReady: () => boolean
  getPlayback: () => PlaybackSnapshot
  getPendingSync: () => EngineSyncState | null
  setPendingSync: (next: EngineSyncState | null) => void
  getLastAppliedAnchorMs: () => number | null
  setLastAppliedAnchorMs: (next: number | null) => void
  /** Room authority paused flag (transport nudge must not fight pause). */
  isAuthorityPaused: () => boolean
  onApplyFailed?: (syncState: EngineSyncState) => void
}

export type PlaybackSyncEngine = {
  phase: () => PlaybackSyncPhase
  start: () => void
  dispose: () => void
  /** Media swap / source change — drop timers and pending verification. */
  reset: () => void
  setHoldLocalSeek: (hold: boolean) => void
  /**
   * Authority timeline anchor changed. Schedules burst verify retries
   * (HLS/proxy often ignores the first currentTime write).
   */
  onAuthorityAnchor: (anchorMs: number) => void
  applyRoomClock: (
    player: SyncablePlayer,
    syncState: EngineSyncState,
    driftThresholdSec?: number,
  ) => void
  clearTransportNudge: () => void
}

export function pendingSyncFromPlaybackSnapshot(
  playback: PlaybackSnapshot,
): EngineSyncState {
  return {
    paused: playback.paused,
    playbackRate: playback.playbackRate,
    timelineAnchorMs: playback.timelineAnchorMs,
    serverNowMs: playback.serverNowMs,
    videoLoop:
      typeof playback.videoLoop === "boolean"
        ? playback.videoLoop
        : playback.videoLoop !== "off",
  }
}

/**
 * Resolve the sync snapshot for a watchdog tick, then decide apply vs clear.
 * Measure and apply must share this same `syncState` (not a fresh playback read).
 */
export function planPlaybackDriftCorrection(input: {
  pending: EngineSyncState | null
  playback: PlaybackSnapshot
  driftSec: number | null
  thresholdSec?: number
}):
  | { action: "noop"; syncState: EngineSyncState }
  | { action: "clear"; syncState: EngineSyncState }
  | { action: "apply"; syncState: EngineSyncState } {
  const syncState =
    input.pending ?? pendingSyncFromPlaybackSnapshot(input.playback)
  if (input.driftSec === null) {
    return { action: "noop", syncState }
  }
  const threshold =
    input.thresholdSec ?? DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC
  if (input.driftSec <= threshold) {
    return { action: "clear", syncState }
  }
  return { action: "apply", syncState }
}

function defaultScheduler(): PlaybackSyncScheduler {
  return {
    nowMs: () => serverNowEstimateMs(),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id),
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (id) => window.clearInterval(id),
  }
}

function readPlayheadSec(player: SyncablePlayer): number {
  const mediaTime = Number(player.mediaEl?.currentTime)
  if (Number.isFinite(mediaTime)) {
    return mediaTime
  }
  return Number(player.currentTime ?? 0)
}

function measureDrift(
  player: SyncablePlayer,
  syncState: EngineSyncState,
  nowMs: number,
): number | null {
  return measurePlaybackDriftSec(
    readPlayheadSec(player),
    syncState,
    nowMs,
    Number(player.duration),
    Number.isFinite(Number(player.seekableEnd))
      ? Number(player.seekableEnd)
      : undefined,
  )
}

/**
 * Single scheduler for authority clock apply, transport nudge retries,
 * HLS verify burst, and steady drift watchdog.
 */
export function createPlaybackSyncEngine(
  host: PlaybackSyncEngineHost,
  scheduler: PlaybackSyncScheduler = defaultScheduler(),
): PlaybackSyncEngine {
  let phase: Exclude<PlaybackSyncPhase, "holdingLocalSeek"> = "idle"
  let holdLocalSeek = false
  let started = false
  let disposed = false

  let playRetryTimer: number | undefined
  let watchdogTimer: number | undefined
  const retryTimers: number[] = []
  let forceSeeksForAnchor = { anchorMs: 0, count: 0 }

  /** Public phase: local-seek hold always wins over internal apply/verify work. */
  const resolvePhase = (): PlaybackSyncPhase => {
    if (holdLocalSeek) {
      return "holdingLocalSeek"
    }
    return phase
  }

  const setPhase = (next: Exclude<PlaybackSyncPhase, "holdingLocalSeek">) => {
    phase = next
  }

  const clearRetryTimers = () => {
    for (const id of retryTimers) {
      scheduler.clearTimeout(id)
    }
    retryTimers.length = 0
  }

  const clearTransportNudge = () => {
    if (playRetryTimer !== undefined) {
      scheduler.clearTimeout(playRetryTimer)
      playRetryTimer = undefined
    }
  }

  const scheduleTransportNudge = (player: SyncablePlayer) => {
    if (host.isAuthorityPaused()) {
      return
    }
    clearTransportNudge()
    playRetryTimer = scheduler.setTimeout(() => {
      playRetryTimer = undefined
      if (disposed || !host.isMediaReady()) {
        return
      }
      if (host.isAuthorityPaused()) {
        return
      }
      if (player.paused === false) {
        return
      }
      void nudgePlaybackTransport({ player, paused: false }).playAttempt
    }, TRANSPORT_NUDGE_RETRY_MS)
  }

  const applyRoomClock = (
    player: SyncablePlayer,
    syncState: EngineSyncState,
    driftThresholdSec?: number,
  ) => {
    if (disposed) {
      return
    }
    setPhase("applying")
    try {
      const seekableEndSec = Number.isFinite(Number(player.seekableEnd))
        ? Number(player.seekableEnd)
        : undefined
      applyPlaybackSyncToPlayer({
        player,
        syncState,
        driftThresholdSec,
        nowMs: scheduler.nowMs(),
        mode: "clock",
        seekableEndSec,
      })
      host.setLastAppliedAnchorMs(syncState.timelineAnchorMs)

      // HLS/proxy often accepts the write asynchronously (or no-ops once).
      // Keep pending until verify / watchdog confirms the playhead caught up.
      const driftSec = measureDrift(player, syncState, scheduler.nowMs())
      const stillDrifting =
        driftSec === null ||
        driftSec > DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC
      host.setPendingSync(stillDrifting ? syncState : null)
      setPhase(stillDrifting ? "verifying" : "idle")

      if (!syncState.paused && player.paused) {
        void nudgePlaybackTransport({ player, paused: false }).playAttempt
        scheduleTransportNudge(player)
      } else if (syncState.paused && player.paused === false) {
        void nudgePlaybackTransport({ player, paused: true }).playAttempt
      }
    } catch {
      host.setPendingSync(syncState)
      host.onApplyFailed?.(syncState)
      setPhase("verifying")
    }
  }

  const tryForceSeek = (
    player: SyncablePlayer,
    syncState: EngineSyncState,
    anchorMs: number,
  ) => {
    if (forceSeeksForAnchor.anchorMs !== anchorMs) {
      forceSeeksForAnchor = { anchorMs, count: 0 }
    }
    if (forceSeeksForAnchor.count >= MAX_FORCE_SEEKS_PER_ANCHOR) {
      return
    }
    forceSeeksForAnchor.count += 1
    // First force seek uses threshold 0; later retries use the default threshold
    // so we do not spam seeks when HLS keeps no-op'ing.
    const threshold =
      forceSeeksForAnchor.count === 1
        ? 0
        : DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC
    applyRoomClock(player, syncState, threshold)
  }

  const runVerifyTick = (anchorAtSchedule: number) => {
    if (disposed || holdLocalSeek || !host.isMediaReady()) {
      return
    }
    const player = host.getPlayer()
    if (!player) {
      return
    }
    if (host.getPlayback().timelineAnchorMs !== anchorAtSchedule) {
      return
    }

    const syncState = pendingSyncFromPlaybackSnapshot(host.getPlayback())
    const driftSec = measureDrift(player, syncState, scheduler.nowMs())
    if (
      driftSec === null ||
      driftSec <= DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC
    ) {
      host.setPendingSync(null)
      if (!holdLocalSeek) {
        setPhase("idle")
      }
      return
    }

    setPhase("verifying")
    tryForceSeek(player, syncState, anchorAtSchedule)
  }

  const scheduleAnchorVerifyBurst = (anchorMs: number) => {
    clearRetryTimers()
    forceSeeksForAnchor = { anchorMs, count: 0 }
    if (holdLocalSeek) {
      return
    }
    if (!holdLocalSeek && phase !== "applying") {
      setPhase("verifying")
    }
    for (const delayMs of ANCHOR_RETRY_DELAYS_MS) {
      const timerId = scheduler.setTimeout(() => {
        runVerifyTick(anchorMs)
      }, delayMs)
      retryTimers.push(timerId)
    }
  }

  const runWatchdogTick = () => {
    if (disposed || holdLocalSeek || !host.isMediaReady()) {
      return
    }
    const player = host.getPlayer()
    if (!player) {
      return
    }

    const syncState =
      host.getPendingSync() ??
      pendingSyncFromPlaybackSnapshot(host.getPlayback())
    const plan = planPlaybackDriftCorrection({
      pending: host.getPendingSync(),
      playback: host.getPlayback(),
      driftSec: measureDrift(player, syncState, scheduler.nowMs()),
    })
    if (plan.action === "noop") {
      return
    }
    if (plan.action === "clear") {
      host.setPendingSync(null)
      if (!holdLocalSeek && phase === "verifying") {
        setPhase("idle")
      }
      return
    }

    setPhase("verifying")
    tryForceSeek(
      player,
      syncState,
      host.getPlayback().timelineAnchorMs,
    )
  }

  const start = () => {
    // React Strict Mode remounts call dispose() then start() on the same instance.
    disposed = false
    if (started) {
      return
    }
    started = true
    watchdogTimer = scheduler.setInterval(
      runWatchdogTick,
      WATCHDOG_INTERVAL_MS,
    )
  }

  const dispose = () => {
    disposed = true
    clearRetryTimers()
    clearTransportNudge()
    if (watchdogTimer !== undefined) {
      scheduler.clearInterval(watchdogTimer)
      watchdogTimer = undefined
    }
    started = false
    phase = "idle"
  }

  const reset = () => {
    clearRetryTimers()
    clearTransportNudge()
    forceSeeksForAnchor = { anchorMs: 0, count: 0 }
    if (!holdLocalSeek) {
      setPhase("idle")
    }
  }

  return {
    phase: resolvePhase,
    start,
    dispose,
    reset,
    setHoldLocalSeek: (hold: boolean) => {
      holdLocalSeek = hold
      if (hold) {
        clearRetryTimers()
        return
      }
      // Leaving hold: resume verify burst for the current authority anchor
      // (previous combined React effect re-ran when holdLocalSeek flipped).
      const pending = host.getPendingSync()
      setPhase(pending ? "verifying" : "idle")
      scheduleAnchorVerifyBurst(host.getPlayback().timelineAnchorMs)
    },
    onAuthorityAnchor: (anchorMs: number) => {
      scheduleAnchorVerifyBurst(anchorMs)
    },
    applyRoomClock,
    clearTransportNudge,
  }
}
