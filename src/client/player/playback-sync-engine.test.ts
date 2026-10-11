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

  test("keeps watchdog catch-up after burst budget for stable anchors", () => {
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
    engine.onAuthorityAnchor(syncState.timelineAnchorMs)

    // Exhaust burst retries + several watchdog ticks while HLS no-ops.
    for (const delay of ANCHOR_RETRY_DELAYS_MS) {
      advance(delay)
    }
    advance(5_000)
    expect(player.seeks.length).toBeGreaterThan(MAX_FORCE_SEEKS_PER_ANCHOR)
    expect(player.currentTime).toBe(0)
    expect(host.getPendingSync()).not.toBeNull()

    // Late canSeek / late joiner: a post-burst watchdog tick must still catch up
    // while timelineAnchorMs stays unchanged for the whole playing segment.
    player.forceAcceptNextSeek()
    advance(1_000)
    expect(player.currentTime).toBe(12)
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

  describe("authoritative pause (HLS / local HTTP)", () => {
    /** Element that ignores pause() until `unblockPause()` (HLS no-op). */
    function createStickyPlayingPlayer(playheadSec: number) {
      let blocked = true
      const pauseCalls: number[] = []
      const player: SyncablePlayer & {
        pauseCalls: number[]
        unblockPause: () => void
        resumeLate: () => void
      } = {
        playbackRate: 1,
        duration: 120,
        paused: false,
        currentTime: playheadSec,
        pauseCalls,
        unblockPause() {
          blocked = false
        },
        resumeLate() {
          this.paused = false
        },
        pause() {
          pauseCalls.push(pauseCalls.length)
          if (!blocked) this.paused = true
        },
        play() {
          this.paused = false
        },
      }
      return player
    }

    const pausedState: EngineSyncState = {
      paused: true,
      playbackRate: 1,
      timelineAnchorMs: 10_000,
      serverNowMs: 1_000,
      videoLoop: false,
    }

    test("retries pause nudge on the burst schedule until the element pauses", () => {
      const { scheduler, advance } = createFakeScheduler(1_000)
      const player = createStickyPlayingPlayer(10)
      const host = createHost({
        player,
        playback: { ...pausedState, videoLoop: "off" },
      })
      const engine = createPlaybackSyncEngine(host, scheduler)
      engine.start()

      engine.applyRoomClock(player, pausedState, 0)
      // Immediate nudge ignored; playhead matches so only the pause is pending.
      expect(player.pauseCalls.length).toBe(1)
      expect(player.paused).toBe(false)
      expect(host.getPendingSync()).toEqual(pausedState)
      expect(engine.phase()).toBe("verifying")

      advance(ANCHOR_RETRY_DELAYS_MS[0]!)
      expect(player.pauseCalls.length).toBeGreaterThanOrEqual(2)
      expect(player.paused).toBe(false)

      player.unblockPause()
      advance(ANCHOR_RETRY_DELAYS_MS[1]! - ANCHOR_RETRY_DELAYS_MS[0]!)
      expect(player.paused).toBe(true)

      // Burst stops nudging once paused; pending clears on verify/watchdog.
      const callsWhenPaused = player.pauseCalls.length
      advance(10_000)
      expect(player.pauseCalls.length).toBe(callsWhenPaused)
      expect(host.getPendingSync()).toBeNull()
    })

    test("late HLS playing after authority pause is re-paused by the watchdog", () => {
      const { scheduler, advance } = createFakeScheduler(1_000)
      const player = createStickyPlayingPlayer(10)
      player.unblockPause()
      const host = createHost({
        player,
        playback: { ...pausedState, videoLoop: "off" },
      })
      const engine = createPlaybackSyncEngine(host, scheduler)
      engine.start()

      engine.applyRoomClock(player, pausedState, 0)
      expect(player.paused).toBe(true)
      expect(host.getPendingSync()).toBeNull()

      // Late `playing` from HLS after the authority pause landed.
      player.resumeLate()
      host.setPendingSync(pausedState)
      advance(1_000) // watchdog tick: playhead in range but transport wrong
      expect(player.paused).toBe(true)
    })

    test("watchdog does not clear pending while paused room still plays", () => {
      const { scheduler, advance } = createFakeScheduler(1_000)
      const player = createStickyPlayingPlayer(10)
      const host = createHost({
        player,
        playback: { ...pausedState, videoLoop: "off" },
      })
      const engine = createPlaybackSyncEngine(host, scheduler)
      engine.start()
      host.setPendingSync(pausedState)

      advance(3_000)
      expect(player.paused).toBe(false)
      expect(host.getPendingSync()).toEqual(pausedState)
      expect(player.pauseCalls.length).toBeGreaterThanOrEqual(3)

      player.unblockPause()
      advance(1_000)
      expect(player.paused).toBe(true)
      advance(1_000)
      expect(host.getPendingSync()).toBeNull()
    })

    test("reads a fresh player on retries (stale adapter snapshot)", () => {
      const { scheduler, advance } = createFakeScheduler(1_000)
      const stale = createStickyPlayingPlayer(10)
      const fresh = createStickyPlayingPlayer(10)
      fresh.unblockPause()
      const host = createHost({
        player: fresh,
        playback: { ...pausedState, videoLoop: "off" },
      })
      const engine = createPlaybackSyncEngine(host, scheduler)
      engine.start()

      engine.applyRoomClock(stale, pausedState, 0)
      advance(ANCHOR_RETRY_DELAYS_MS[0]!)
      expect(fresh.paused).toBe(true)
    })

    test("resuming the room cancels outstanding pause retries", () => {
      const { scheduler, advance } = createFakeScheduler(1_000)
      const player = createStickyPlayingPlayer(10)
      const host = createHost({
        player,
        playback: { ...pausedState, videoLoop: "off" },
      })
      const engine = createPlaybackSyncEngine(host, scheduler)
      engine.start()

      engine.applyRoomClock(player, pausedState, 0)
      const resumed: EngineSyncState = {
        ...pausedState,
        paused: false,
      }
      host.setPlayback({ ...resumed, videoLoop: "off" })
      const callsAfterApply = player.pauseCalls.length
      engine.applyRoomClock(player, resumed, 0)
      advance(10_000)
      expect(player.pauseCalls.length).toBe(callsAfterApply)
    })
  })

  describe("late-join / force-seek convergence", () => {
    /**
     * Playhead model: advances with the fake clock while playing, so tests
     * assert real playhead position (not room presence grain).
     */
    function createMeasuredPlayer(config: {
      now: () => number
      startSec: number
      acceptSeeks?: boolean
    }) {
      let baseSec = config.startSec
      let baseAtMs = config.now()
      let accept = config.acceptSeeks ?? true
      const seeks: number[] = []
      const mediaSeeks: number[] = []
      const readSec = () =>
        player.paused
          ? baseSec
          : baseSec + (config.now() - baseAtMs) / 1000
      const write = (value: number) => {
        baseSec = value
        baseAtMs = config.now()
      }
      const mediaEl = {
        get currentTime() {
          return readSec()
        },
        set currentTime(value: number) {
          mediaSeeks.push(value)
          if (accept) write(value)
        },
      }
      const player: SyncablePlayer & {
        seeks: number[]
        mediaSeeks: number[]
        setAccept: (v: boolean) => void
      } = {
        playbackRate: 1,
        duration: 600,
        paused: false,
        mediaEl,
        seeks,
        mediaSeeks,
        setAccept(v) {
          accept = v
        },
        get currentTime() {
          return readSec()
        },
        set currentTime(value: number) {
          seeks.push(value)
        },
        pause() {
          write(readSec())
          this.paused = true
        },
        play() {
          write(baseSec)
          this.paused = false
        },
      }
      return player
    }

    test("first ready apply uses threshold 0 once (small late-join offset)", () => {
      const sched = createFakeScheduler(10_000)
      const player = createMeasuredPlayer({
        now: () => sched.now,
        startSec: 5.5,
      })
      const state: EngineSyncState = {
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 6_000,
        serverNowMs: 10_000,
        videoLoop: false,
      }
      const host = createHost({
        player,
        playback: { ...state, videoLoop: "off" },
      })
      const engine = createPlaybackSyncEngine(host, sched.scheduler)
      engine.start()

      // 0.5s behind: within the default 0.8s threshold, yet the first ready
      // apply must still snap to the authority clock.
      engine.applyRoomClock(player, state)
      expect(player.mediaSeeks).toEqual([6])
      expect(player.mediaEl!.currentTime).toBeCloseTo(6, 3)

      // Second apply (undefined threshold) goes back to default 0.8s.
      sched.advance(100)
      player.mediaEl!.currentTime = 6.1 + 0.4 // mediaSeeks bookkeeping below
      const before = player.mediaSeeks.length
      engine.applyRoomClock(player, state)
      expect(player.mediaSeeks.length).toBe(before)
    })

    test("does not consume the snap while media is not ready", () => {
      const sched = createFakeScheduler(10_000)
      const player = createMeasuredPlayer({
        now: () => sched.now,
        startSec: 5.5,
      })
      const state: EngineSyncState = {
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 6_000,
        serverNowMs: 10_000,
        videoLoop: false,
      }
      const host = createHost({
        player,
        playback: { ...state, videoLoop: "off" },
        mediaReady: false,
      })
      const engine = createPlaybackSyncEngine(host, sched.scheduler)
      engine.start()

      engine.applyRoomClock(player, state)
      expect(player.mediaSeeks).toEqual([])

      host.setMediaReady(true)
      engine.applyRoomClock(player, state)
      expect(player.mediaSeeks).toEqual([6])
    })

    test("keeps pending until within 0.8s and re-arms retries after media ready", () => {
      const sched = createFakeScheduler(10_000)
      const player = createMeasuredPlayer({
        now: () => sched.now,
        startSec: 0,
        acceptSeeks: false,
      })
      const state: EngineSyncState = {
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 30_000,
        serverNowMs: 10_000,
        videoLoop: false,
      }
      const host = createHost({
        player,
        playback: { ...state, videoLoop: "off" },
      })
      const engine = createPlaybackSyncEngine(host, sched.scheduler)
      engine.start()

      // Authority-anchor burst expired long before media became ready.
      engine.onAuthorityAnchor(state.timelineAnchorMs)
      host.setMediaReady(false)
      sched.advance(10_000)
      host.setMediaReady(true)
      expect(player.mediaSeeks).toEqual([])

      // First ready apply: HLS no-ops the force seek → pending persists.
      engine.applyRoomClock(player, state)
      expect(player.mediaSeeks.length).toBe(1)
      expect(host.getPendingSync()).toEqual(state)
      expect(engine.phase()).toBe("verifying")

      // Element starts accepting seeks; burst retry (re-armed) converges.
      player.setAccept(true)
      sched.advance(ANCHOR_RETRY_DELAYS_MS[0]!)
      const room = pendingExpectedSec(state, sched.now)
      expect(
        Math.abs(player.mediaEl!.currentTime - room),
      ).toBeLessThanOrEqual(DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC)
      expect(host.getPendingSync()).toBeNull()
      expect(engine.phase()).toBe("idle")
    })

    test("reset re-arms the late-join snap for the next media", () => {
      const sched = createFakeScheduler(10_000)
      const player = createMeasuredPlayer({
        now: () => sched.now,
        startSec: 5.5,
      })
      const state: EngineSyncState = {
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 6_000,
        serverNowMs: 10_000,
        videoLoop: false,
      }
      const host = createHost({
        player,
        playback: { ...state, videoLoop: "off" },
      })
      const engine = createPlaybackSyncEngine(host, sched.scheduler)
      engine.start()
      engine.applyRoomClock(player, state)
      expect(player.mediaSeeks.length).toBe(1)

      engine.reset()
      player.mediaEl!.currentTime = 5.5 // simulate new media offset
      const before = player.mediaSeeks.length
      engine.applyRoomClock(player, state)
      expect(player.mediaSeeks.length).toBe(before + 1)
    })

    test("anchor jump writes both wrapper and media element and keeps retrying", () => {
      const sched = createFakeScheduler(10_000)
      const player = createMeasuredPlayer({
        now: () => sched.now,
        startSec: 20,
        acceptSeeks: false,
      })
      const state: EngineSyncState = {
        paused: true,
        playbackRate: 1,
        timelineAnchorMs: 90_000,
        serverNowMs: 10_000,
        videoLoop: false,
      }
      const host = createHost({
        player,
        playback: { ...state, videoLoop: "off" },
      })
      const engine = createPlaybackSyncEngine(host, sched.scheduler)
      engine.start()

      engine.applyRoomClock(player, state, 0)
      expect(player.seeks).toEqual([90])
      expect(player.mediaSeeks).toEqual([90])

      engine.onAuthorityAnchor(state.timelineAnchorMs)
      for (const delay of ANCHOR_RETRY_DELAYS_MS) {
        sched.advance(delay)
      }
      // Burst keeps force-seeking both targets while the element no-ops.
      expect(player.mediaSeeks.length).toBeGreaterThan(3)
      expect(player.seeks.length).toBe(player.mediaSeeks.length)
      expect(host.getPendingSync()).not.toBeNull()

      player.setAccept(true)
      sched.advance(1_000)
      expect(player.mediaEl!.currentTime).toBeCloseTo(90, 3)
      expect(host.getPendingSync()).toBeNull()
    })
  })
})

function pendingExpectedSec(state: EngineSyncState, nowMs: number): number {
  return (
    state.timelineAnchorMs / 1000 +
    (state.paused ? 0 : ((nowMs - state.serverNowMs) / 1000) * state.playbackRate)
  )
}
