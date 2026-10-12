import {
  applyPlaybackSyncToPlayer,
  escalateSeekWhilePaused,
  isHlsWrapperMediaEcho,
  isSyncablePlayerPlaying,
  nudgePlaybackTransport,
  readPlayerPlayheadSec,
  writeSyncableNumber,
  type SyncablePlayer,
} from "@/client/player/apply-playback-sync"
import {
  CATCH_UP_CLEAR_DRIFT_SEC,
  CATCH_UP_DRIFT_MAX_SEC,
  computeExpectedPlaybackTimeSec,
  DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
  FORCE_SEEK_LEAD_SEC,
  isCatchUpDriftBand,
  measurePlaybackDriftSec,
  resolveCatchUpPlaybackRate,
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

export const WATCHDOG_INTERVAL_MS = 1_000
/**
 * HLS often no-ops the first currentTime write; retry while the anchor is
 * fresh. The tail (4s/6s) extends the burst for slow proxies / late canSeek.
 * Pause/play transport nudges reuse the same schedule.
 */
export const ANCHOR_RETRY_DELAYS_MS = [
  200, 600, 1_200, 2_400, 4_000, 6_000,
] as const
/** Cap force-threshold seeks per anchor to avoid HLS seek storms. */
export const MAX_FORCE_SEEKS_PER_ANCHOR = 6
/**
 * Catch-up stall escalate: if mediaEl has not advanced by this much over
 * {@link CATCH_UP_STALL_WINDOW_MS} while playing with drift > soft threshold,
 * drop rate catch-up and hard-seek (threshold 0).
 */
export const CATCH_UP_STALL_MIN_ADVANCE_SEC = 0.15
export const CATCH_UP_STALL_WINDOW_MS = 800
/**
 * After a seek, HLS/SoundCloud often freeze the playhead while the new
 * buffer fills (~2–3s). Suppress stall escalate during this grace so a
 * routine late-join seek cannot immediately retrigger a threshold-0 seek
 * and leave sticky mid-range lag.
 */
export const CATCH_UP_STALL_POST_SEEK_GRACE_MS = 2_500

/**
 * Playing-path correction order (do not collapse into one boolean):
 * 1. Native duration gated → no hard seeks
 * 2. Seek-confirm pending + near room → suppress threshold-0 re-force
 * 3. Catch-up band (not forcing, not HLS echo, not stalled) → rate only
 * 4. Stall escalate / HLS echo / drift > catch-up max → force seek
 * 5. threshold 0 + playing → write with FORCE_SEEK_LEAD_SEC
 */

type AnchorBudget = { anchorMs: number; count: number }

function resetAnchorBudget(
  budget: AnchorBudget,
  anchorMs: number,
): AnchorBudget {
  return budget.anchorMs === anchorMs ? budget : { anchorMs, count: 0 }
}

function tryConsumeAnchorBudget(
  budget: AnchorBudget,
  anchorMs: number,
  max: number,
): { budget: AnchorBudget; consumed: boolean } {
  const next = resetAnchorBudget(budget, anchorMs)
  if (next.count >= max) {
    return { budget: next, consumed: false }
  }
  return { budget: { ...next, count: next.count + 1 }, consumed: true }
}

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
  /**
   * Local-only catch-up rate while closing mid-range playing drift.
   * `null` when inactive — UI should bind `catchUpRate ?? roomPlaybackRate`.
   */
  getCatchUpRate: () => number | null
  setCatchUpRate: (next: number | null) => void
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

  let watchdogTimer: number | undefined
  const retryTimers: number[] = []
  /** Shared burst timers for authority pause *or* play transport nudges. */
  const pauseTimers: number[] = []
  /** First ready apply after media swap uses threshold 0 (late-join snap). */
  let initialSnapPending = true
  let forceSeeksForAnchor: AnchorBudget = { anchorMs: 0, count: 0 }
  /** Muted play→seek→pause escalations budgeted per authority anchor. */
  let escalationsForAnchor: AnchorBudget = { anchorMs: 0, count: 0 }
  /**
   * Catch-up stall probe: mediaEl sample used to detect a frozen playhead
   * under mid-range lag (HLS/SC late-join buffer stuck).
   */
  let catchUpStallSample: { atMs: number; mediaSec: number } | null = null
  /** Scheduler clock when a seek was last attempted (stall post-seek grace). */
  let lastSeekMs: number | null = null
  const native = createNativeSyncTracker()
  /** Native only: hard seeks were skipped because duration was unknown. */
  let durationGated = false

  const isNativeSync = () =>
    host.getSyncTuning?.()?.nativeProvider === true
  /** Catalog duration; `Infinity` means catalog-live (see usePlayerPlaybackSync). */
  const rawDurationHintSec = () => host.getDurationHintSec?.()
  const isCatalogLive = () => rawDurationHintSec() === Number.POSITIVE_INFINITY
  const vodDurationHintSec = (): number | null | undefined => {
    const hint = rawDurationHintSec()
    if (hint === Number.POSITIVE_INFINITY) {
      return null
    }
    return hint
  }
  const nativeDurationReady = (player: SyncablePlayer) =>
    isNativeDurationReady({
      playerDurationSec: Number(player.duration),
      hintDurationSec: rawDurationHintSec(),
    })

  /** Seek-confirm probe: native iframes always; HTML5 only while playing. */
  const useSeekConfirm = (syncState: EngineSyncState, nativeMode: boolean) =>
    nativeMode || !syncState.paused

  const clearCatchUpRate = (player?: SyncablePlayer | null) => {
    if (host.getCatchUpRate() === null) {
      return
    }
    host.setCatchUpRate(null)
    const target = player ?? host.getPlayer()
    const roomRate = Number(host.getPlayback().playbackRate)
    if (target && Number.isFinite(roomRate)) {
      writeSyncableNumber(target, "playbackRate", roomRate)
    }
  }

  const resetCatchUpStallSample = () => {
    catchUpStallSample = null
  }

  const noteSeekAttempt = (nowMs: number) => {
    lastSeekMs = nowMs
    resetCatchUpStallSample()
  }

  const readStallMediaSec = (player: SyncablePlayer): number | null => {
    if (player.mediaEl != null) {
      const sec = Number(player.mediaEl.currentTime)
      return Number.isFinite(sec) ? sec : null
    }
    const sec = readPlayerPlayheadSec(player)
    return Number.isFinite(sec) ? sec : null
  }

  /**
   * True when media has not advanced enough over the stall window while the
   * room is playing with material drift. First observation only arms the
   * sample so catch-up can still run short of the window. Seeks suppress
   * escalation for {@link CATCH_UP_STALL_POST_SEEK_GRACE_MS} so HLS/SC
   * post-seek buffering cannot look like a stuck catch-up.
   */
  const shouldEscalateCatchUpStall = (
    player: SyncablePlayer,
    syncState: EngineSyncState,
    driftSec: number | null,
  ): boolean => {
    if (
      syncState.paused ||
      driftSec === null ||
      driftSec <= DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC
    ) {
      resetCatchUpStallSample()
      return false
    }
    const mediaSec = readStallMediaSec(player)
    if (mediaSec === null) {
      return false
    }
    const nowMs = scheduler.nowMs()
    if (
      lastSeekMs !== null &&
      nowMs - lastSeekMs < CATCH_UP_STALL_POST_SEEK_GRACE_MS
    ) {
      resetCatchUpStallSample()
      return false
    }
    if (catchUpStallSample === null) {
      catchUpStallSample = { atMs: nowMs, mediaSec }
      return false
    }
    const elapsedMs = nowMs - catchUpStallSample.atMs
    if (elapsedMs < CATCH_UP_STALL_WINDOW_MS) {
      return false
    }
    const advanced = mediaSec - catchUpStallSample.mediaSec
    if (advanced >= CATCH_UP_STALL_MIN_ADVANCE_SEC) {
      catchUpStallSample = { atMs: nowMs, mediaSec }
      return false
    }
    resetCatchUpStallSample()
    return true
  }

  const activateCatchUpRate = (
    player: SyncablePlayer,
    syncState: EngineSyncState,
    driftSec: number,
  ): number | null => {
    const rate = resolveCatchUpPlaybackRate(syncState.playbackRate, driftSec)
    if (rate === null) {
      return null
    }
    host.setCatchUpRate(rate)
    writeSyncableNumber(player, "playbackRate", rate)
    return rate
  }

  /** Playing (HTML5 + native): allow intentional force-seek lead without false drift. */
  const playingSeekLeadSec = (syncState: EngineSyncState) =>
    syncState.paused ? 0 : FORCE_SEEK_LEAD_SEC

  const measureDrift = (
    player: SyncablePlayer,
    syncState: EngineSyncState,
    nowMs: number,
  ): number | null =>
    measurePlaybackDriftSec(
      readPlayerPlayheadSec(player),
      syncState,
      nowMs,
      Number(player.duration),
      Number.isFinite(Number(player.seekableEnd))
        ? Number(player.seekableEnd)
        : undefined,
      vodDurationHintSec(),
      isCatalogLive(),
      playingSeekLeadSec(syncState),
    )

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

  /** True while at least one verify-burst timer has not fired yet. */
  const hasPendingRetryTimers = () => retryTimers.length > 0

  const clearPauseTimers = () => {
    for (const id of pauseTimers) {
      scheduler.clearTimeout(id)
    }
    pauseTimers.length = 0
  }

  const clearTransportNudge = () => {
    clearPauseTimers()
  }

  /** Room says paused but the element is still playing (HLS/local HTTP). */
  const isPlayingAgainstPause = (player: SyncablePlayer) =>
    host.isAuthorityPaused() && isSyncablePlayerPlaying(player)

  /**
   * Native iframe pause: sample the playhead; while it still advances (or the
   * wrapper says playing) re-issue pause() unconditionally — `paused` lies.
   * Returns true once the provider is quiescent.
   */
  const settleNativePause = (player: SyncablePlayer): boolean => {
    const { quiescent } = native.samplePauseQuiescence({
      currentSec: readPlayerPlayheadSec(player),
      wrapperPaused: player.paused,
      nowMs: scheduler.nowMs(),
    })
    if (quiescent) return true
    try {
      player.pause()
    } catch {
      // Provider may be rebuilding.
    }
    return false
  }

  /** Imperative pause when authority is paused; keeps the burst armed. */
  const reconcilePausedTransport = (player: SyncablePlayer) => {
    if (!isPlayingAgainstPause(player)) {
      return false
    }
    void nudgePlaybackTransport({ player, paused: true })
    return true
  }

  /** Room wants play but the element is still paused; keep pending. */
  const reconcilePlayingTransport = (player: SyncablePlayer) => {
    if (host.isAuthorityPaused() || isSyncablePlayerPlaying(player)) {
      return false
    }
    void nudgePlaybackTransport({ player, paused: false }).playAttempt
    return true
  }

  /**
   * Authority pause *or* play transport burst on the shared pause/seek retry
   * schedule. Reads a fresh player each tick (adapter snapshots go stale).
   */
  const scheduleTransportBurst = (paused: boolean) => {
    if (!paused && host.isAuthorityPaused()) {
      return
    }
    clearPauseTimers()
    for (const delayMs of pauseRetryDelaysMs()) {
      const timerId = scheduler.setTimeout(() => {
        if (disposed) {
          return
        }
        if (paused) {
          if (!host.isAuthorityPaused()) {
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
          if (!isSyncablePlayerPlaying(fresh)) {
            return
          }
          void nudgePlaybackTransport({ player: fresh, paused: true })
          return
        }
        if (!host.isMediaReady() || host.isAuthorityPaused()) {
          return
        }
        const fresh = host.getPlayer()
        if (!fresh || isSyncablePlayerPlaying(fresh)) {
          return
        }
        void nudgePlaybackTransport({ player: fresh, paused: false }).playAttempt
      }, delayMs)
      pauseTimers.push(timerId)
    }
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
    // Late join: keep force-snapping (threshold 0) until the playhead actually
    // converges. Clearing the flag on the first attempt left iframe/HLS
    // no-ops stranded ~20s behind after a short settle.
    const isInitialSnap =
      !gated && initialSnapPending && host.isMediaReady()
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
      const playheadBeforeSec = readPlayerPlayheadSec(player)
      const driftBeforeSec = measureDrift(player, syncState, nowMs)
      // While a playing/native seek-confirm probe is outstanding and the
      // playhead is already near the clock, do not re-force (threshold 0) —
      // wait for motion confirmation. Verify/watchdog still force-seeks when
      // drift grows past the threshold during rebuffer.
      if (
        useSeekConfirm(syncState, nativeMode) &&
        native.hasSeekProbe() &&
        driftThresholdSec === undefined &&
        effectiveThresholdSec === 0 &&
        driftBeforeSec !== null &&
        driftBeforeSec <= DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC
      ) {
        effectiveThresholdSec = Number.POSITIVE_INFINITY
      }
      // Mid-range playing drift: prefer local rate catch-up over another hard
      // seek (force/snap threshold 0 and drift > CATCH_UP_DRIFT_MAX_SEC still seek).
      // Explicit caller thresholds (budgeted force seeks, including soft 0.8)
      // must not be rewritten to Infinity — that swallowed the seek path.
      const forcing =
        driftThresholdSec !== undefined ||
        effectiveThresholdSec === 0 ||
        (effectiveThresholdSec !== undefined &&
          effectiveThresholdSec < DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC)
      const catchUpInsteadOfSeek =
        !nativeMode &&
        !syncState.paused &&
        !gated &&
        !forcing &&
        driftBeforeSec !== null &&
        isCatchUpDriftBand(driftBeforeSec)
      if (catchUpInsteadOfSeek) {
        effectiveThresholdSec = Number.POSITIVE_INFINITY
      }
      const catchUpRate = catchUpInsteadOfSeek
        ? resolveCatchUpPlaybackRate(
            syncState.playbackRate,
            driftBeforeSec,
          )
        : nativeMode || syncState.paused
          ? null
          : host.getCatchUpRate()
      // Playing force/snap (threshold 0 / initialSnap / stall escalate):
      // lead the write so seek latency does not strand the playhead behind.
      // Soft 0.8 seeks do not lead; paused never leads. allowAheadSec keeps
      // soft seeks from undoing a prior lead (HTML5 + native).
      const allowAheadSec = playingSeekLeadSec(syncState)
      const seekLeadSec =
        allowAheadSec > 0 && effectiveThresholdSec === 0 ? allowAheadSec : 0
      const result = applyPlaybackSyncToPlayer({
        player,
        syncState,
        driftThresholdSec: effectiveThresholdSec,
        nowMs,
        mode: "clock",
        seekableEndSec,
        durationHintSec: vodDurationHintSec(),
        isLive: isCatalogLive(),
        effectivePlaybackRate: catchUpRate ?? syncState.playbackRate,
        seekLeadSec,
        allowAheadSec,
      })
      if (!gated) {
        host.setLastAppliedAnchorMs(syncState.timelineAnchorMs)
      }

      let seekConfirmPending = false
      const targetSec = result.targetSec
      const seekConfirm = useSeekConfirm(syncState, nativeMode)
      if (result.seekAttempted) {
        // Force-seek / stall-escalate / late-join snap: arm post-seek grace
        // so catch-up stall cannot immediately re-seek into sticky lag.
        noteSeekAttempt(nowMs)
      }
      if (seekConfirm && !gated) {
        if (result.seekAttempted && targetSec !== null) {
          // The wrapper may echo the requested time immediately; only a later
          // read that moved toward the target can confirm the seek.
          native.noteSeek({
            anchorMs: syncState.timelineAnchorMs,
            fromSec: playheadBeforeSec,
            targetSec,
            nowMs,
          })
          seekConfirmPending = true
        } else if (native.hasSeekProbe()) {
          seekConfirmPending =
            native.evaluateSeek({
              anchorMs: syncState.timelineAnchorMs,
              currentSec: readPlayerPlayheadSec(player),
              driftSec: result.driftSec,
              thresholdSec: DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
              roomPaused: syncState.paused,
              nowMs,
            }) === "pending"
        }
      }

      // HLS/proxy: wrapper currentTime often echoes the target while the
      // underlying media element stays at the buffered position (~5s). Prefer
      // mediaEl for drift below; also keep pending when wrapper/media disagree
      // so same-tick "success" cannot clear retries.
      let mediaAfterSec =
        player.mediaEl != null ? Number(player.mediaEl.currentTime) : null
      let wrapperAfterSec = Number(player.currentTime)
      const echoUnconfirmed = () =>
        !nativeMode &&
        result.seekAttempted &&
        targetSec !== null &&
        isHlsWrapperMediaEcho({
          mediaSec: mediaAfterSec,
          wrapperSec: wrapperAfterSec,
          referenceSec: targetSec,
        })
      let hlsSeekEchoUnconfirmed = echoUnconfirmed()

      // Seek-while-paused: paused HLS often ignores currentTime until a
      // play-gated seek. Escalate once (budgeted) with muted play→seek→pause.
      let driftSec = measureDrift(player, syncState, scheduler.nowMs())
      if (
        !nativeMode &&
        syncState.paused &&
        result.seekAttempted &&
        targetSec !== null &&
        mediaAfterSec !== null &&
        Number.isFinite(mediaAfterSec) &&
        Math.abs(mediaAfterSec - targetSec) >
          DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC &&
        driftSec !== null &&
        driftSec > DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC
      ) {
        const anchorMs = syncState.timelineAnchorMs
        const consumed = tryConsumeAnchorBudget(
          escalationsForAnchor,
          anchorMs,
          maxForceSeeks(),
        )
        escalationsForAnchor = consumed.budget
        if (consumed.consumed) {
          escalateSeekWhilePaused({ player, targetSec })
          noteSeekAttempt(scheduler.nowMs())
          mediaAfterSec =
            player.mediaEl != null ? Number(player.mediaEl.currentTime) : null
          wrapperAfterSec = Number(player.currentTime)
          driftSec = measureDrift(player, syncState, scheduler.nowMs())
          hlsSeekEchoUnconfirmed = echoUnconfirmed()
        }
      }
      if (!syncState.paused && !isSyncablePlayerPlaying(player)) {
        native.resetPauseSamples()
        void nudgePlaybackTransport({ player, paused: false }).playAttempt
        scheduleTransportBurst(false)
      } else if (syncState.paused) {
        if (isSyncablePlayerPlaying(player)) {
          void nudgePlaybackTransport({ player, paused: true })
        }
        // Always arm: pause() may no-op now or HLS may resume on `playing`.
        scheduleTransportBurst(true)
      } else {
        clearPauseTimers()
        native.resetPauseSamples()
      }

      // A playing element against a paused room (or paused against a playing
      // room) is unconverged even when the playhead matches — keep pending so
      // transport events cannot clear it early.
      // Re-read after the nudge: a synchronous pause()/play() converges
      // immediately. Native: wrapper `paused` can lie, so also wait for
      // quiescence (the apply itself only baselines the sample, never settles).
      const nativePauseUnsettled =
        nativeMode &&
        !gated &&
        syncState.paused &&
        !settleNativePause(host.getPlayer() ?? player)
      const afterPlayer = host.getPlayer() ?? player
      const pauseUnconverged =
        (syncState.paused && isSyncablePlayerPlaying(afterPlayer)) ||
        nativePauseUnsettled
      const playUnconverged =
        !syncState.paused && !isSyncablePlayerPlaying(afterPlayer)
      const stillDrifting =
        gated ||
        seekConfirmPending ||
        hlsSeekEchoUnconfirmed ||
        driftSec === null ||
        driftSec > DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC ||
        pauseUnconverged ||
        playUnconverged
      // Only consume the late-join snap once media is ready *and* converged.
      // A not-ready apply can look "within threshold" and must not burn the snap.
      if (!stillDrifting && !gated && host.isMediaReady()) {
        initialSnapPending = false
      }
      host.setPendingSync(stillDrifting ? syncState : null)
      setPhase(stillDrifting ? "verifying" : "idle")

      // Catch-up rate: activate for mid-range playing drift; clear when
      // converged, paused, native, holding local seek, or outside the band.
      if (nativeMode || syncState.paused || holdLocalSeek) {
        clearCatchUpRate(player)
        resetCatchUpStallSample()
      } else if (
        driftSec !== null &&
        driftSec <= CATCH_UP_CLEAR_DRIFT_SEC
      ) {
        clearCatchUpRate(player)
        resetCatchUpStallSample()
      } else if (
        catchUpInsteadOfSeek &&
        driftSec !== null &&
        isCatchUpDriftBand(driftSec)
      ) {
        activateCatchUpRate(player, syncState, driftSec)
      } else if (
        host.getCatchUpRate() !== null &&
        (driftSec === null || driftSec > CATCH_UP_DRIFT_MAX_SEC)
      ) {
        clearCatchUpRate(player)
        resetCatchUpStallSample()
      }

      if (
        stillDrifting &&
        !holdLocalSeek &&
        !hasPendingRetryTimers() &&
        (isInitialSnap ||
          reapplyAfterGate ||
          hlsSeekEchoUnconfirmed ||
          result.seekAttempted ||
          (driftSec !== null &&
            driftSec > DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC))
      ) {
        // Re-arm for late-join and HLS seek-while-paused. Skip when a burst
        // is already in flight so force-seeks do not reset the schedule.
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
    options?: { thresholdSec?: number },
  ) => {
    if (forceSeeksForAnchor.anchorMs !== anchorMs) {
      forceSeeksForAnchor = { anchorMs, count: 0 }
      escalationsForAnchor = { anchorMs, count: 0 }
    }
    const consumed = tryConsumeAnchorBudget(
      forceSeeksForAnchor,
      anchorMs,
      maxForceSeeks(),
    )
    forceSeeksForAnchor = consumed.budget
    if (!consumed.consumed) {
      // Burst budget spent (slow YouTube iframe / late canSeek). Keep applying
      // at the normal drift threshold so late joiners are not stranded for the
      // entire remaining play session while timelineAnchorMs stays fixed.
      applyRoomClock(
        player,
        syncState,
        options?.thresholdSec ?? DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
      )
      return
    }
    // First seek: hard snap (threshold 0) so late-join / echo / large lag
    // actually moves. Later HTML5 seeks use the normal drift threshold so
    // residual sub-threshold noise cannot rebuffer-storm. Native iframes
    // keep threshold 0 for every budgeted force seek. Stall escalate always
    // passes threshold 0 explicitly.
    const thresholdSec =
      options?.thresholdSec ??
      (forceSeeksForAnchor.count === 1 || isNativeSync()
        ? 0
        : DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC)
    applyRoomClock(player, syncState, thresholdSec)
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
   * Keep pending while a written seek is unconfirmed (wrapper echoes the
   * target) or a paused native room's provider is not yet quiescent.
   */
  const seekConfirmShouldHold = (
    player: SyncablePlayer,
    syncState: EngineSyncState,
    driftSec: number | null,
  ): boolean => {
    const seekVerdict = native.evaluateSeek({
      anchorMs: syncState.timelineAnchorMs,
      currentSec: readPlayerPlayheadSec(player),
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

  /**
   * HLS dual-echo vs the live room clock — force-seek instead of catch-up
   * (rate cannot fix a stuck buffer).
   */
  const hlsEchoUnconfirmed = (
    player: SyncablePlayer,
    syncState: EngineSyncState,
    nativeMode: boolean,
  ): boolean => {
    if (nativeMode || player.mediaEl == null) {
      return false
    }
    return isHlsWrapperMediaEcho({
      mediaSec: player.mediaEl.currentTime,
      wrapperSec: player.currentTime,
      referenceSec: computeExpectedPlaybackTimeSec(
        syncState,
        scheduler.nowMs(),
      ),
    })
  }

  /**
   * Correct mid-range playing drift with local rate catch-up when a hard seek
   * is not required. An outstanding seek-confirm probe no longer blocks
   * catch-up; force-seek for large lag, native, paused, HLS echo, or a
   * frozen playhead past the catch-up stall window.
   */
  const tryCatchUpOrForceSeek = (
    player: SyncablePlayer,
    syncState: EngineSyncState,
    driftSec: number,
    anchorMs: number,
    nativeMode: boolean,
  ) => {
    if (
      !nativeMode &&
      shouldEscalateCatchUpStall(player, syncState, driftSec)
    ) {
      clearCatchUpRate(player)
      tryForceSeek(player, syncState, anchorMs, { thresholdSec: 0 })
      return
    }
    if (
      !nativeMode &&
      !syncState.paused &&
      isCatchUpDriftBand(driftSec) &&
      !hlsEchoUnconfirmed(player, syncState, nativeMode)
    ) {
      if (activateCatchUpRate(player, syncState, driftSec) !== null) {
        host.setPendingSync(syncState)
        setPhase("verifying")
        return
      }
    }
    tryForceSeek(player, syncState, anchorMs)
  }

  /** Shared verify/watchdog sample: drift + transport + seek-confirm hold. */
  const sampleTickConvergence = (
    player: SyncablePlayer,
    syncState: EngineSyncState,
    nativeMode: boolean,
  ) => {
    const driftSec = measureDrift(player, syncState, scheduler.nowMs())
    const pauseUnconverged = reconcilePausedTransport(player)
    const playUnconverged = reconcilePlayingTransport(player)
    const seekConfirmHold =
      useSeekConfirm(syncState, nativeMode) &&
      seekConfirmShouldHold(player, syncState, driftSec)
    return {
      driftSec,
      pauseUnconverged,
      playUnconverged,
      seekConfirmHold,
    }
  }

  const clearPendingWhenConverged = (
    player: SyncablePlayer,
    driftSec: number | null,
  ) => {
    initialSnapPending = false
    host.setPendingSync(null)
    if (driftSec === null || driftSec <= CATCH_UP_CLEAR_DRIFT_SEC) {
      clearCatchUpRate(player)
      resetCatchUpStallSample()
    }
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
    const {
      driftSec,
      pauseUnconverged,
      playUnconverged,
      seekConfirmHold,
    } = sampleTickConvergence(player, syncState, nativeMode)
    if (
      !pauseUnconverged &&
      !playUnconverged &&
      !seekConfirmHold &&
      (driftSec === null ||
        driftSec <= DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC)
    ) {
      clearPendingWhenConverged(player, driftSec)
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
      tryCatchUpOrForceSeek(
        player,
        syncState,
        driftSec,
        anchorAtSchedule,
        nativeMode,
      )
    } else {
      // Playhead is fine; only transport (or seek confirmation) is outstanding.
      host.setPendingSync(syncState)
    }
  }

  const scheduleAnchorVerifyBurst = (anchorMs: number) => {
    clearRetryTimers()
    forceSeeksForAnchor = { anchorMs, count: 0 }
    // Escalations stay budgeted for the whole anchor, not each burst re-arm.
    escalationsForAnchor = resetAnchorBudget(escalationsForAnchor, anchorMs)
    if (holdLocalSeek) {
      return
    }
    if (phase !== "applying") {
      setPhase("verifying")
    }
    for (const delayMs of retryDelaysMs()) {
      const timerId = scheduler.setTimeout(() => {
        const idx = retryTimers.indexOf(timerId)
        if (idx >= 0) {
          retryTimers.splice(idx, 1)
        }
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
    // Steady-state transport enforcement: HLS `playing` must not leave a
    // paused room running, and a stuck pause must not clear pending below.
    const {
      driftSec,
      pauseUnconverged,
      playUnconverged,
      seekConfirmHold,
    } = sampleTickConvergence(player, syncState, nativeMode)
    const plan = planPlaybackDriftCorrection({
      pending: host.getPendingSync(),
      playback: host.getPlayback(),
      driftSec,
    })
    if (plan.action === "noop") {
      return
    }
    if (plan.action === "clear") {
      if (pauseUnconverged || playUnconverged || seekConfirmHold) {
        host.setPendingSync(syncState)
        return
      }
      clearPendingWhenConverged(player, driftSec)
      if (!holdLocalSeek && phase === "verifying") {
        setPhase("idle")
      }
      return
    }

    setPhase("verifying")
    if (driftSec !== null) {
      tryCatchUpOrForceSeek(
        player,
        syncState,
        driftSec,
        host.getPlayback().timelineAnchorMs,
        nativeMode,
      )
    } else {
      tryForceSeek(
        player,
        syncState,
        host.getPlayback().timelineAnchorMs,
      )
    }
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
    clearCatchUpRate()
    resetCatchUpStallSample()
    lastSeekMs = null
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
    clearCatchUpRate()
    resetCatchUpStallSample()
    lastSeekMs = null
    initialSnapPending = true
    durationGated = false
    native.reset()
    forceSeeksForAnchor = { anchorMs: 0, count: 0 }
    escalationsForAnchor = { anchorMs: 0, count: 0 }
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
        clearCatchUpRate()
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
