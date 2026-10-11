import {
  applyPlaybackSyncToPlayer,
  nudgePlaybackTransport,
  readPlayerPlayheadSec,
  type SyncablePlayer,
} from "@/client/player/apply-playback-sync"
import {
  DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
  computeExpectedPlaybackTimeSec,
  measurePlaybackDriftSec,
  resolveSeekCeilingSec,
  type PlaybackSyncState,
} from "@/client/player/playback-sync"
import {
  createNativeSyncTracker,
  isNativeDurationReady,
} from "@/client/player/native-provider-sync"
import { pendingSyncFromPlayback } from "@/client/player/pending-sync"
import type { ProviderSyncTuning } from "@/client/player/provider-sync-tuning"
import { serverNowEstimateMs } from "@/shared/server-clock"

/** Single scheduler phases for room ↔ local playhead sync. */
export type PlaybackSyncPhase =
  | "idle"
  | "applying"
  | "verifying"
  | "holdingLocalSeek"

export const TRANSPORT_NUDGE_RETRY_MS = 350
export const WATCHDOG_INTERVAL_MS = 1_000
/**
 * HLS often no-ops the first currentTime write; retry while the anchor is
 * fresh. The tail (4s/6s) extends the burst for slow proxies / late canSeek.
 * Pause nudges reuse the same schedule.
 */
export const ANCHOR_RETRY_DELAYS_MS = [
  200, 600, 1_200, 2_400, 4_000, 6_000,
] as const
/** Cap force-threshold seeks per anchor to avoid HLS seek storms. */
export const MAX_FORCE_SEEKS_PER_ANCHOR = 6

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
  /**
   * Provider-aware overrides (YouTube/Vimeo iframes). Read at schedule time so
   * a media swap picks up the new provider. Omit / return `undefined` for the
   * default (HLS / direct media) schedule.
   */
  getSyncTuning?: () => ProviderSyncTuning | undefined
  /**
   * Catalog duration (seconds) for native providers whose wrapper duration is
   * 0/NaN until the iframe boots. `Infinity` for live. Used by the native
   * duration gate only.
   */
  getDurationHintSec?: () => number | null | undefined
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
  /**
   * Native providers: a finite duration just became available (catalog or
   * `onDurationChange`). Re-applies the room clock if sync was gated.
   */
  onDurationAvailable: () => void
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
    input.pending ?? pendingSyncFromPlayback(input.playback)
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

const readPlayheadSec = readPlayerPlayheadSec

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
  const pauseTimers: number[] = []
  /** First ready apply after media swap uses threshold 0 (late-join snap). */
  let initialSnapPending = true
  let forceSeeksForAnchor = { anchorMs: 0, count: 0 }
  const native = createNativeSyncTracker()
  /** Native only: hard seeks were skipped because duration was unknown. */
  let durationGated = false

  const isNativeSync = () =>
    host.getSyncTuning?.()?.nativeProvider === true
  const nativeDurationReady = (player: SyncablePlayer) =>
    isNativeDurationReady({
      playerDurationSec: Number(player.duration),
      hintDurationSec: host.getDurationHintSec?.(),
    })

  const retryDelaysMs = (): readonly number[] =>
    host.getSyncTuning?.()?.retryDelaysMs ?? ANCHOR_RETRY_DELAYS_MS
  const pauseRetryDelaysMs = (): readonly number[] => {
    const tuning = host.getSyncTuning?.()
    return (
      tuning?.pauseRetryDelaysMs ??
      tuning?.retryDelaysMs ??
      ANCHOR_RETRY_DELAYS_MS
    )
  }
  const maxForceSeeks = () =>
    host.getSyncTuning?.()?.maxForceSeeksPerAnchor ??
    MAX_FORCE_SEEKS_PER_ANCHOR

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

  const clearPauseTimers = () => {
    for (const id of pauseTimers) {
      scheduler.clearTimeout(id)
    }
    pauseTimers.length = 0
  }

  const clearTransportNudge = () => {
    if (playRetryTimer !== undefined) {
      scheduler.clearTimeout(playRetryTimer)
      playRetryTimer = undefined
    }
    clearPauseTimers()
  }

  /** Room says paused but the element is still playing (HLS/local HTTP). */
  const isPlayingAgainstPause = (player: SyncablePlayer) =>
    host.isAuthorityPaused() && player.paused === false

  /**
   * Native iframe pause: sample the playhead; while it still advances (or the
   * wrapper says playing) re-issue pause() unconditionally — `paused` lies.
   * Returns true once the provider is quiescent.
   */
  const settleNativePause = (player: SyncablePlayer): boolean => {
    const { quiescent, sampled } = native.samplePauseQuiescence({
      currentSec: readPlayheadSec(player),
      wrapperPaused: player.paused,
      nowMs: scheduler.nowMs(),
    })
    if (quiescent) {
      return true
    }
    if (sampled || player.paused === false) {
      try {
        player.pause()
      } catch {
        // Provider may be rebuilding.
      }
    }
    return false
  }

  /**
   * Authority pause: HLS/local HTTP can ignore the first pause() or resume on
   * a late `playing` event. Retry on the same burst schedule as seeks, reading
   * a fresh player each tick (adapter snapshots go stale).
   */
  const schedulePauseNudgeBurst = () => {
    clearPauseTimers()
    for (const delayMs of pauseRetryDelaysMs()) {
      const timerId = scheduler.setTimeout(() => {
        if (disposed || !host.isAuthorityPaused()) {
          return
        }
        const fresh = host.getPlayer()
        if (!fresh) {
          return
        }
        if (isNativeSync()) {
          // Wrapper `paused` can lie; keep pausing until the playhead settles.
          settleNativePause(fresh)
          return
        }
        if (fresh.paused !== false) {
          return
        }
        void nudgePlaybackTransport({ player: fresh, paused: true })
      }, delayMs)
      pauseTimers.push(timerId)
    }
  }

  /** Imperative pause when authority is paused; keeps the burst armed. */
  const reconcilePausedTransport = (player: SyncablePlayer) => {
    if (!isPlayingAgainstPause(player)) {
      return false
    }
    void nudgePlaybackTransport({ player, paused: true })
    return true
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
      const fresh = host.getPlayer() ?? player
      if (fresh.paused === false) {
        return
      }
      void nudgePlaybackTransport({ player: fresh, paused: false }).playAttempt
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
    const nativeMode = isNativeSync()
    // Native: no hard seeks until duration is known (iframe seek is a no-op
    // before boot). Re-applied via onDurationAvailable / verify / watchdog.
    const gated = nativeMode && !nativeDurationReady(player)
    if (gated) {
      durationGated = true
    }
    const reapplyAfterGate = nativeMode && !gated && durationGated
    if (reapplyAfterGate) {
      durationGated = false
    }
    const isInitialSnap =
      !gated && initialSnapPending && host.isMediaReady()
    if (isInitialSnap) {
      initialSnapPending = false
    }
    // Late join: first ready apply force-snaps to the room clock (threshold 0)
    // unless the caller already chose a threshold.
    let effectiveThresholdSec =
      driftThresholdSec ??
      (isInitialSnap || reapplyAfterGate ? 0 : undefined)
    if (gated) {
      effectiveThresholdSec = Number.POSITIVE_INFINITY
    } else if (
      nativeMode &&
      syncState.paused &&
      effectiveThresholdSec === undefined &&
      native.claimPauseSeek(
        `${syncState.timelineAnchorMs}:${syncState.serverNowMs}`,
      )
    ) {
      // Room pause / anchor change on iframe: hard-seek to the anchor once,
      // then the pause burst repeats until the provider is quiescent.
      effectiveThresholdSec = 0
    }
    setPhase("applying")
    try {
      const seekableEndSec = Number.isFinite(Number(player.seekableEnd))
        ? Number(player.seekableEnd)
        : undefined
      const nowMs = scheduler.nowMs()
      const playheadBeforeSec = readPlayheadSec(player)
      const result = applyPlaybackSyncToPlayer({
        player,
        syncState,
        driftThresholdSec: effectiveThresholdSec,
        nowMs,
        mode: "clock",
        seekableEndSec,
      })
      if (!gated) {
        host.setLastAppliedAnchorMs(syncState.timelineAnchorMs)
      }

      let nativeSeekPending = false
      if (nativeMode && !gated) {
        if (result.seekAttempted) {
          // The wrapper may echo the requested time immediately; only a later
          // read that moved toward the target can confirm the seek.
          const ceiling = resolveSeekCeilingSec({
            durationSec: Number(player.duration),
            seekableEndSec,
          })
          const expectedSec = computeExpectedPlaybackTimeSec(syncState, nowMs)
          native.noteSeek({
            anchorMs: syncState.timelineAnchorMs,
            fromSec: playheadBeforeSec,
            targetSec:
              ceiling !== null ? Math.min(expectedSec, ceiling) : expectedSec,
            nowMs,
          })
          nativeSeekPending = true
        } else if (native.hasSeekProbe()) {
          nativeSeekPending =
            native.evaluateSeek({
              anchorMs: syncState.timelineAnchorMs,
              currentSec: readPlayheadSec(player),
              driftSec: result.driftSec,
              thresholdSec: DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
              roomPaused: syncState.paused,
              nowMs,
            }) === "pending"
        }
      }

      // HLS/proxy often accepts the write asynchronously (or no-ops once).
      // Keep pending until verify / watchdog confirms the playhead caught up.
      const driftSec = measureDrift(player, syncState, scheduler.nowMs())
      if (!syncState.paused && player.paused) {
        clearPauseTimers()
        native.resetPauseSamples()
        void nudgePlaybackTransport({ player, paused: false }).playAttempt
        scheduleTransportNudge(player)
      } else if (syncState.paused) {
        if (player.paused === false) {
          void nudgePlaybackTransport({ player, paused: true })
        }
        // Always arm: pause() may no-op now or HLS may resume on `playing`.
        schedulePauseNudgeBurst()
      } else {
        clearPauseTimers()
        native.resetPauseSamples()
      }

      // A playing element against a paused room is unconverged even when the
      // playhead matches — keep pending so `playing` events cannot clear it.
      // Re-read after the nudge: a synchronous pause() converges immediately.
      // Native: wrapper `paused` can lie, so also wait for quiescence (the
      // apply itself only baselines the sample, never settles).
      const nativePauseUnsettled =
        nativeMode &&
        !gated &&
        syncState.paused &&
        !settleNativePause(host.getPlayer() ?? player)
      const pauseUnconverged =
        (syncState.paused && host.getPlayer()?.paused === false) ||
        nativePauseUnsettled
      const stillDrifting =
        gated ||
        nativeSeekPending ||
        driftSec === null ||
        driftSec > DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC ||
        pauseUnconverged
      host.setPendingSync(stillDrifting ? syncState : null)
      setPhase(stillDrifting ? "verifying" : "idle")

      if (
        (isInitialSnap || reapplyAfterGate) &&
        stillDrifting &&
        !holdLocalSeek
      ) {
        // Media became ready after the authority-anchor burst expired
        // (late join). Re-arm verify retries until within threshold.
        scheduleAnchorVerifyBurst(host.getPlayback().timelineAnchorMs)
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
    if (forceSeeksForAnchor.count >= maxForceSeeks()) {
      // Burst budget spent (slow YouTube iframe / late canSeek). Keep applying
      // at the normal drift threshold so late joiners are not stranded for the
      // entire remaining play session while timelineAnchorMs stays fixed.
      applyRoomClock(
        player,
        syncState,
        DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
      )
      return
    }
    forceSeeksForAnchor.count += 1
    // First force seek uses threshold 0; later burst retries use the default
    // threshold so we do not spam hard seeks when HLS keeps no-op'ing.
    const threshold =
      forceSeeksForAnchor.count === 1
        ? 0
        : DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC
    applyRoomClock(player, syncState, threshold)
  }

  /**
   * Native duration gate for verify/watchdog ticks. Returns true when the tick
   * is fully handled (still gated, or re-applied now that duration arrived).
   */
  const gateNativeTick = (
    player: SyncablePlayer,
    syncState: EngineSyncState,
  ): boolean => {
    if (!nativeDurationReady(player)) {
      durationGated = true
      host.setPendingSync(syncState)
      setPhase("verifying")
      return true
    }
    if (durationGated) {
      applyRoomClock(player, syncState)
      return true
    }
    return false
  }

  /**
   * Native: keep pending while a written seek is unconfirmed (wrapper echoes
   * the target) or a paused room's provider is not yet quiescent.
   */
  const nativeShouldHold = (
    player: SyncablePlayer,
    syncState: EngineSyncState,
    driftSec: number | null,
  ): boolean => {
    const seekVerdict = native.evaluateSeek({
      anchorMs: syncState.timelineAnchorMs,
      currentSec: readPlayheadSec(player),
      driftSec,
      thresholdSec: DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
      roomPaused: syncState.paused,
      nowMs: scheduler.nowMs(),
    })
    if (seekVerdict === "pending") {
      return true
    }
    if (syncState.paused) {
      return !settleNativePause(player)
    }
    return false
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

    const syncState = pendingSyncFromPlayback(host.getPlayback())
    const nativeMode = isNativeSync()
    if (nativeMode && gateNativeTick(player, syncState)) {
      return
    }
    const driftSec = measureDrift(player, syncState, scheduler.nowMs())
    const pauseUnconverged = reconcilePausedTransport(player)
    const nativeHold = nativeMode && nativeShouldHold(player, syncState, driftSec)
    if (
      !pauseUnconverged &&
      !nativeHold &&
      (driftSec === null ||
        driftSec <= DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC)
    ) {
      host.setPendingSync(null)
      if (!holdLocalSeek) {
        setPhase("idle")
      }
      return
    }

    setPhase("verifying")
    if (
      driftSec !== null &&
      driftSec > DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC
    ) {
      tryForceSeek(player, syncState, anchorAtSchedule)
    } else {
      // Playhead is fine; only the paused transport (or native confirmation)
      // is outstanding.
      host.setPendingSync(syncState)
    }
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
    for (const delayMs of retryDelaysMs()) {
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
      host.getPendingSync() ?? pendingSyncFromPlayback(host.getPlayback())
    const nativeMode = isNativeSync()
    if (nativeMode && gateNativeTick(player, syncState)) {
      return
    }
    const driftSec = measureDrift(player, syncState, scheduler.nowMs())
    const plan = planPlaybackDriftCorrection({
      pending: host.getPendingSync(),
      playback: host.getPlayback(),
      driftSec,
    })
    // Steady-state pause enforcement: HLS `playing` must not leave a paused
    // room running (and must not clear pending below).
    const pauseUnconverged = reconcilePausedTransport(player)
    if (plan.action === "noop") {
      return
    }
    if (plan.action === "clear") {
      const nativeHold =
        nativeMode && nativeShouldHold(player, syncState, driftSec)
      if (pauseUnconverged || nativeHold) {
        host.setPendingSync(syncState)
        return
      }
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
    initialSnapPending = true
    durationGated = false
    native.reset()
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
    initialSnapPending = true
    durationGated = false
    native.reset()
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
    onDurationAvailable: () => {
      if (disposed || holdLocalSeek || !isNativeSync() || !host.isMediaReady()) {
        return
      }
      const player = host.getPlayer()
      if (!player || !nativeDurationReady(player)) {
        return
      }
      if (!durationGated) {
        return
      }
      const playback = host.getPlayback()
      applyRoomClock(player, pendingSyncFromPlayback(playback))
      scheduleAnchorVerifyBurst(playback.timelineAnchorMs)
    },
  }
}
