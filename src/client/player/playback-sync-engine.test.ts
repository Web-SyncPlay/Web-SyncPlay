import { describe, expect, test } from "bun:test"
import type { SyncablePlayer } from "./apply-playback-sync"
import {
  ANCHOR_RETRY_DELAYS_MS,
  createPlaybackSyncEngine,
  MAX_FORCE_SEEKS_PER_ANCHOR,
  planPlaybackDriftCorrection,
  type EngineSyncState,
  type PlaybackSnapshot,
  type PlaybackSyncEngineHost,
  type PlaybackSyncScheduler,
} from "./playback-sync-engine"
import { DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC } from "./playback-sync"

type FakeTimer = {
  id: number
  kind: "timeout" | "interval"
  due: number
  fn: () => void
  intervalMs?: number
}

function createFakeScheduler(startMs = 1_000) {
  let now = startMs
  let nextId = 1
  const timers: FakeTimer[] = []

  const scheduler: PlaybackSyncScheduler = {
    nowMs: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId++
      timers.push({ id, kind: "timeout", due: now + ms, fn })
      return id
    },
    clearTimeout: (id) => {
      const idx = timers.findIndex((t) => t.id === id && t.kind === "timeout")
      if (idx >= 0) timers.splice(idx, 1)
    },
    setInterval: (fn, ms) => {
      const id = nextId++
      timers.push({
        id,
        kind: "interval",
        due: now + ms,
        fn,
        intervalMs: ms,
      })
      return id
    },
    clearInterval: (id) => {
      const idx = timers.findIndex((t) => t.id === id && t.kind === "interval")
      if (idx >= 0) timers.splice(idx, 1)
    },
  }

  const advance = (ms: number) => {
    const target = now + ms
    while (true) {
      const due = timers
        .filter((t) => t.due <= target)
        .sort((a, b) => a.due - b.due)
      if (due.length === 0) {
        now = target
        return
      }
      const next = due[0]!
      now = next.due
      if (next.kind === "timeout") {
        const idx = timers.indexOf(next)
        if (idx >= 0) timers.splice(idx, 1)
        next.fn()
      } else {
        next.due = now + (next.intervalMs ?? 0)
        next.fn()
      }
    }
  }

  return { scheduler, advance, get now() { return now }, timers }
}

function createHlsNoopPlayer(initialTime = 0): SyncablePlayer & {
  seeks: number[]
  forceAcceptNextSeek: () => void
} {
  let currentTime = initialTime
  let acceptSeeks = false
  const seeks: number[] = []
  const player: SyncablePlayer & {
    seeks: number[]
    forceAcceptNextSeek: () => void
  } = {
    playbackRate: 1,
    duration: 120,
    paused: false,
    seeks,
    get currentTime() {
      return currentTime
    },
    set currentTime(value: number) {
      seeks.push(value)
      // Simulate HLS wrapper no-op until unblocked.
      if (acceptSeeks) {
        currentTime = value
        acceptSeeks = false
      }
    },
    forceAcceptNextSeek() {
      acceptSeeks = true
    },
    pause() {
      this.paused = true
    },
    play() {
      this.paused = false
    },
  }
  return player
}

function createHost(config: {
  player: SyncablePlayer | null
  playback: PlaybackSnapshot
  mediaReady?: boolean
  authorityPaused?: boolean
}): PlaybackSyncEngineHost & {
  applyFailures: EngineSyncState[]
  setPlayer: (p: SyncablePlayer | null) => void
  setPlayback: (p: PlaybackSnapshot) => void
  setMediaReady: (ready: boolean) => void
} {
  let player = config.player
  let playback = config.playback
  let mediaReady = config.mediaReady ?? true
  let pending: EngineSyncState | null = null
  let lastApplied: number | null = null
  const applyFailures: EngineSyncState[] = []

  return {
    applyFailures,
    setPlayer: (p) => {
      player = p
    },
    setPlayback: (p) => {
      playback = p
    },
    setMediaReady: (ready) => {
      mediaReady = ready
    },
    getPlayer: () => player,
    isMediaReady: () => mediaReady,
    getPlayback: () => playback,
    getPendingSync: () => pending,
    setPendingSync: (next) => {
      pending = next
    },
    getLastAppliedAnchorMs: () => lastApplied,
    setLastAppliedAnchorMs: (next) => {
      lastApplied = next
    },
    isAuthorityPaused: () => config.authorityPaused ?? playback.paused,
    onApplyFailed: (syncState) => {
      applyFailures.push(syncState)
    },
  }
}

describe("planPlaybackDriftCorrection", () => {
  const playback: PlaybackSnapshot = {
    paused: false,
    playbackRate: 1,
    timelineAnchorMs: 9_000,
    serverNowMs: 1_000,
    videoLoop: "off",
  }
  const pending: EngineSyncState = {
    paused: false,
    playbackRate: 1,
    timelineAnchorMs: 1_000,
    serverNowMs: 1_000,
    videoLoop: false,
  }

  test("prefers pending syncState for measure/apply pairing", () => {
    const plan = planPlaybackDriftCorrection({
      pending,
      playback,
      driftSec: 2,
      thresholdSec: 0.35,
    })
    expect(plan.action).toBe("apply")
    expect(plan.syncState).toBe(pending)
  })

  test("clears when drift is within threshold", () => {
    const plan = planPlaybackDriftCorrection({
      pending,
      playback,
      driftSec: 0.1,
      thresholdSec: 0.35,
    })
    expect(plan.action).toBe("clear")
  })
})

describe("PlaybackSyncEngine", () => {
  test("phase: applying → verifying when HLS no-ops first write", () => {
    const { scheduler } = createFakeScheduler(1_000)
    const player = createHlsNoopPlayer(0)
    const syncState: EngineSyncState = {
      paused: false,
      playbackRate: 1,
      timelineAnchorMs: 5_000,
      serverNowMs: 1_000,
      videoLoop: false,
    }
    const host = createHost({
      player,
      playback: { ...syncState, videoLoop: "off" },
    })
    const engine = createPlaybackSyncEngine(host, scheduler)
    engine.start()

    expect(engine.phase()).toBe("idle")
    engine.applyRoomClock(player, syncState, 0)
    // First write no-op'd — playhead still at 0, pending kept for verify.
    expect(player.currentTime).toBe(0)
    expect(player.seeks.length).toBe(1)
    expect(host.getPendingSync()).toEqual(syncState)
    expect(engine.phase()).toBe("verifying")
    expect(host.getLastAppliedAnchorMs()).toBe(5_000)
  })

  test("authority seek while HLS no-ops first write recovers on verify burst", () => {
    const { scheduler, advance } = createFakeScheduler(1_000)
    const player = createHlsNoopPlayer(0)
    const syncState: EngineSyncState = {
      paused: true,
      playbackRate: 1,
      timelineAnchorMs: 8_000,
      serverNowMs: 1_000,
      videoLoop: false,
    }
    const host = createHost({
      player,
      playback: { ...syncState, videoLoop: "off" },
    })
    const engine = createPlaybackSyncEngine(host, scheduler)
    engine.start()

    engine.applyRoomClock(player, syncState, 0)
    expect(engine.phase()).toBe("verifying")
    expect(player.currentTime).toBe(0)

    engine.onAuthorityAnchor(syncState.timelineAnchorMs)

    // Unblock HLS before the first burst retry lands.
    player.forceAcceptNextSeek()
    advance(ANCHOR_RETRY_DELAYS_MS[0]!)

    expect(player.currentTime).toBe(8)
    expect(host.getPendingSync()).toBeNull()
    expect(engine.phase()).toBe("idle")
  })

  test("phase transitions: holdingLocalSeek blocks verify, then resumes", () => {
    const { scheduler, advance } = createFakeScheduler(1_000)
    const player = createHlsNoopPlayer(0)
    const syncState: EngineSyncState = {
      paused: true,
      playbackRate: 1,
      timelineAnchorMs: 4_000,
      serverNowMs: 1_000,
      videoLoop: false,
    }
    const host = createHost({
      player,
      playback: { ...syncState, videoLoop: "off" },
    })
    const engine = createPlaybackSyncEngine(host, scheduler)
    engine.start()

    engine.setHoldLocalSeek(true)
    expect(engine.phase()).toBe("holdingLocalSeek")

    engine.onAuthorityAnchor(syncState.timelineAnchorMs)
    engine.applyRoomClock(player, syncState, 0)
    // Apply still records pending, but phase reports local-seek hold.
    expect(engine.phase()).toBe("holdingLocalSeek")

    advance(ANCHOR_RETRY_DELAYS_MS[0]!)
    // Burst was not scheduled while holding — still no accepted seek.
    expect(player.currentTime).toBe(0)

    player.forceAcceptNextSeek()
    engine.setHoldLocalSeek(false)
    expect(engine.phase()).toBe("verifying")

    advance(ANCHOR_RETRY_DELAYS_MS[0]!)
    expect(player.currentTime).toBe(4)
    expect(engine.phase()).toBe("idle")
  })

  test("caps force seeks per anchor at MAX_FORCE_SEEKS_PER_ANCHOR", () => {
    const { scheduler, advance } = createFakeScheduler(1_000)
    const player = createHlsNoopPlayer(0)
    const syncState: EngineSyncState = {
      paused: true,
      playbackRate: 1,
      timelineAnchorMs: 12_000,
      serverNowMs: 1_000,
      videoLoop: false,
    }
    const host = createHost({
      player,
      playback: { ...syncState, videoLoop: "off" },
    })
    const engine = createPlaybackSyncEngine(host, scheduler)
    engine.start()

    engine.applyRoomClock(player, syncState, 0)
    const seeksAfterAuthority = player.seeks.length
    engine.onAuthorityAnchor(syncState.timelineAnchorMs)

    // Fire all burst delays + several watchdog ticks; HLS keeps no-op'ing.
    for (const delay of ANCHOR_RETRY_DELAYS_MS) {
      advance(delay)
    }
    advance(5_000)

    const forceSeeks = player.seeks.length - seeksAfterAuthority
    expect(forceSeeks).toBeLessThanOrEqual(MAX_FORCE_SEEKS_PER_ANCHOR)
    expect(player.currentTime).toBe(0)
    expect(host.getPendingSync()).not.toBeNull()
  })

  test("successful apply within threshold goes idle and clears pending", () => {
    const { scheduler } = createFakeScheduler(1_000)
    let currentTime = 5
    const player: SyncablePlayer = {
      playbackRate: 1,
      duration: 120,
      paused: true,
      get currentTime() {
        return currentTime
      },
      set currentTime(value: number) {
        currentTime = value
      },
      pause() {
        this.paused = true
      },
      play() {
        this.paused = false
      },
    }
    const syncState: EngineSyncState = {
      paused: true,
      playbackRate: 1,
      timelineAnchorMs: 5_000,
      serverNowMs: 1_000,
      videoLoop: false,
    }
    const host = createHost({
      player,
      playback: { ...syncState, videoLoop: "off" },
    })
    const engine = createPlaybackSyncEngine(host, scheduler)
    engine.start()

    engine.applyRoomClock(
      player,
      syncState,
      DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
    )
    expect(host.getPendingSync()).toBeNull()
    expect(engine.phase()).toBe("idle")
  })

  test("reset clears transport nudge and returns to idle", () => {
    const { scheduler, timers } = createFakeScheduler(1_000)
    const player = createHlsNoopPlayer(0)
    player.paused = true
    const syncState: EngineSyncState = {
      paused: false,
      playbackRate: 1,
      timelineAnchorMs: 3_000,
      serverNowMs: 1_000,
      videoLoop: false,
    }
    const host = createHost({
      player,
      playback: { ...syncState, videoLoop: "off" },
      authorityPaused: false,
    })
    const engine = createPlaybackSyncEngine(host, scheduler)
    engine.start()

    engine.applyRoomClock(player, syncState, 0)
    expect(timers.some((t) => t.kind === "timeout")).toBe(true)

    engine.reset()
    expect(engine.phase()).toBe("idle")
    // Transport nudge timeout cleared; watchdog interval remains until dispose.
    expect(
      timers.filter((t) => t.kind === "timeout").length,
    ).toBe(0)
  })
})
