import { describe, expect, test } from "bun:test"
import type { SyncablePlayer } from "./apply-playback-sync"
import {
  ANCHOR_RETRY_DELAYS_MS,
  CATCH_UP_STALL_POST_SEEK_GRACE_MS,
  CATCH_UP_STALL_WINDOW_MS,
  createPlaybackSyncEngine,
  MAX_FORCE_SEEKS_PER_ANCHOR,
  WATCHDOG_INTERVAL_MS,
  planPlaybackDriftCorrection,
  type EngineSyncState,
  type PlaybackSnapshot,
  type PlaybackSyncEngineHost,
  type PlaybackSyncScheduler,
} from "./playback-sync-engine"
import { NATIVE_MIN_CONFIRM_MS } from "./native-provider-sync"
import {
  DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
  FORCE_SEEK_LEAD_SEC,
  resolveCatchUpPlaybackRate,
} from "./playback-sync"

function stubMediaEl(init: { currentTime?: number; paused?: boolean } = {}) {
  return {
    currentTime: init.currentTime ?? 0,
    paused: init.paused ?? true,
    muted: false,
    playbackRate: 1,
    pause() {
      this.paused = true
    },
    play() {
      this.paused = false
      return Promise.resolve()
    },
  }
}

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
  let catchUpRate: number | null = null
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
    getCatchUpRate: () => catchUpRate,
    setCatchUpRate: (next) => {
      catchUpRate = next
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

    test("local pause edge: threshold 0 snaps + pauses even under 0.8s drift", () => {
      const { scheduler, advance } = createFakeScheduler(1_000)
      // 0.3s ahead of the paused anchor: under the default 0.8s threshold.
      const player = createStickyPlayingPlayer(10.3)
      player.unblockPause()
      const host = createHost({
        player,
        playback: { ...pausedState, videoLoop: "off" },
      })
      const engine = createPlaybackSyncEngine(host, scheduler)
      engine.start()

      // Burn the one-shot late-join snap, then re-enter at sub-threshold drift.
      engine.applyRoomClock(player, pausedState)
      player.currentTime = 10.3
      player.resumeLate()
      // Default threshold leaves the playhead alone but still pauses.
      engine.applyRoomClock(player, pausedState)
      expect(player.paused).toBe(true)
      expect(player.currentTime).toBe(10.3)

      // Authority pause edge uses threshold 0 → exact snap to the anchor.
      player.resumeLate()
      engine.clearTransportNudge()
      engine.applyRoomClock(player, pausedState, 0)
      expect(player.paused).toBe(true)
      expect(player.currentTime).toBe(10)
      advance(1_000)
      expect(player.paused).toBe(true)
    })

    test("authority pause cancels a queued play retry", () => {
      const { scheduler, advance } = createFakeScheduler(1_000)
      const player = createStickyPlayingPlayer(10)
      player.unblockPause()
      player.paused = true
      let playCalls = 0
      // Provider ignores play() so the retry timer would keep firing.
      player.play = () => {
        playCalls += 1
      }
      const playingState: EngineSyncState = { ...pausedState, paused: false }
      let authorityPaused = false
      const host = createHost({
        player,
        playback: { ...playingState, videoLoop: "off" },
      })
      host.isAuthorityPaused = () => authorityPaused
      const engine = createPlaybackSyncEngine(host, scheduler)
      engine.start()

      engine.applyRoomClock(player, playingState, 0)
      expect(playCalls).toBe(1)

      authorityPaused = true
      host.setPlayback({ ...pausedState, videoLoop: "off" })
      engine.applyRoomClock(player, pausedState, 0)
      expect(player.paused).toBe(true)
      advance(1_000)
      expect(playCalls).toBe(1)
    })

    test("retries play nudge on the burst schedule until the element plays", () => {
      const { scheduler, advance } = createFakeScheduler(1_000)
      const player = createStickyPlayingPlayer(10)
      player.unblockPause()
      player.paused = true
      let playCalls = 0
      // Sticky: ignore play() until the 4th attempt (burst + verify may share ticks).
      player.play = () => {
        playCalls += 1
        if (playCalls >= 4) {
          player.paused = false
        }
      }
      const playingState: EngineSyncState = { ...pausedState, paused: false }
      const host = createHost({
        player,
        playback: { ...playingState, videoLoop: "off" },
        authorityPaused: false,
      })
      const engine = createPlaybackSyncEngine(host, scheduler)
      engine.start()

      engine.applyRoomClock(player, playingState, 0)
      expect(playCalls).toBe(1)
      expect(player.paused).toBe(true)
      expect(host.getPendingSync()).toEqual(playingState)
      expect(engine.phase()).toBe("verifying")

      advance(ANCHOR_RETRY_DELAYS_MS[0]!)
      expect(playCalls).toBeGreaterThanOrEqual(2)
      expect(player.paused).toBe(true)

      advance(ANCHOR_RETRY_DELAYS_MS[2]!)
      expect(player.paused).toBe(false)

      // Burst stops once playing (remaining delay ticks no-op).
      const callsWhenPlaying = playCalls
      advance(ANCHOR_RETRY_DELAYS_MS[4]! - ANCHOR_RETRY_DELAYS_MS[2]!)
      expect(playCalls).toBe(callsWhenPlaying)
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

    test("wrapper paused + mediaEl playing still gets pause nudges (HLS lie)", () => {
      const { scheduler, advance } = createFakeScheduler(1_000)
      const mediaEl = stubMediaEl({ currentTime: 10, paused: false })
      const player: SyncablePlayer = {
        playbackRate: 1,
        duration: 120,
        paused: true, // declarative room binding already flipped the wrapper
        currentTime: 10,
        mediaEl,
        pause() {
          this.paused = true
        },
        play() {
          this.paused = false
        },
      }
      const host = createHost({
        player,
        playback: { ...pausedState, videoLoop: "off" },
      })
      const engine = createPlaybackSyncEngine(host, scheduler)
      engine.start()

      engine.applyRoomClock(player, pausedState, 0)
      expect(mediaEl.paused).toBe(true)
      expect(host.getPendingSync()).toBeNull()

      // Late resume on the element only (wrapper still reports paused).
      mediaEl.paused = false
      host.setPendingSync(pausedState)
      advance(1_000)
      expect(mediaEl.paused).toBe(true)
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
        paused: false,
        muted: false,
        playbackRate: 1,
        get currentTime() {
          return readSec()
        },
        set currentTime(value: number) {
          mediaSeeks.push(value)
          if (accept) write(value)
        },
        pause() {
          this.paused = true
        },
        play() {
          this.paused = false
          return Promise.resolve()
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

    test("playing force-seek leads for HTML5 and native; paused does not", () => {
      const sched = createFakeScheduler(10_000)
      const html5 = createMeasuredPlayer({
        now: () => sched.now,
        startSec: 0,
      })
      const playing: EngineSyncState = {
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 10_000,
        serverNowMs: 10_000,
        videoLoop: false,
      }
      const paused: EngineSyncState = { ...playing, paused: true }
      const html5Host = createHost({
        player: html5,
        playback: { ...playing, videoLoop: "off" },
      })
      const html5Engine = createPlaybackSyncEngine(html5Host, sched.scheduler)
      html5Engine.start()
      html5Engine.applyRoomClock(html5, playing, 0)
      expect(html5.mediaSeeks.at(-1)!).toBeCloseTo(10 + FORCE_SEEK_LEAD_SEC, 5)

      html5.mediaEl!.currentTime = 0
      html5Engine.applyRoomClock(html5, paused, 0)
      expect(html5.mediaSeeks.at(-1)!).toBeCloseTo(10, 5)

      const nativePlayer = createMeasuredPlayer({
        now: () => sched.now,
        startSec: 0,
      })
      nativePlayer.duration = 120
      const nativeHost = createHost({
        player: nativePlayer,
        playback: { ...playing, videoLoop: "off" },
      })
      nativeHost.getSyncTuning = () => ({
        nativeProvider: true,
        retryDelaysMs: ANCHOR_RETRY_DELAYS_MS,
        maxForceSeeksPerAnchor: MAX_FORCE_SEEKS_PER_ANCHOR,
      })
      const nativeEngine = createPlaybackSyncEngine(nativeHost, sched.scheduler)
      nativeEngine.start()
      nativeEngine.applyRoomClock(nativePlayer, playing, 0)
      expect(nativePlayer.mediaSeeks.at(-1)!).toBeCloseTo(
        10 + FORCE_SEEK_LEAD_SEC,
        5,
      )

      nativePlayer.mediaEl!.currentTime = 0
      nativeEngine.applyRoomClock(nativePlayer, paused, 0)
      expect(nativePlayer.mediaSeeks.at(-1)!).toBeCloseTo(10, 5)
    })

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
      // apply must still force-snap with playing seek lead.
      engine.applyRoomClock(player, state)
      expect(player.mediaSeeks).toEqual([6 + FORCE_SEEK_LEAD_SEC])
      expect(player.mediaEl!.currentTime).toBeCloseTo(
        6 + FORCE_SEEK_LEAD_SEC,
        3,
      )

      // After convergence, subsequent applies use the default 0.8s threshold
      // and must not undo the intentional lead band.
      sched.advance(100)
      const before = player.mediaSeeks.length
      engine.applyRoomClock(player, state)
      expect(player.mediaSeeks.length).toBe(before)
    })

    test("seek-while-paused keeps pending when HLS echoes then stays behind", () => {
      const { scheduler, advance } = createFakeScheduler(1_000)
      // Wrapper echoes the seek target immediately; media element stays put
      // until unblock — matches false-live HLS seek-while-paused.
      let mediaTime = 5
      let accept = false
      let wrapperTime = 5
      const mediaEl = {
        muted: false,
        playbackRate: 1,
        get currentTime() {
          return mediaTime
        },
        set currentTime(value: number) {
          if (accept) mediaTime = value
        },
        paused: true,
        pause() {
          this.paused = true
        },
        play() {
          this.paused = false
          return Promise.resolve()
        },
      }
      const player: SyncablePlayer = {
        playbackRate: 1,
        duration: 5.05, // buffer-as-duration lie
        seekableEnd: 5.01,
        paused: true,
        mediaEl,
        get currentTime() {
          return wrapperTime
        },
        set currentTime(value: number) {
          wrapperTime = value // echo
          if (accept) mediaTime = value
        },
        pause() {
          this.paused = true
        },
        play() {
          this.paused = false
        },
      }
      const pausedSeek: EngineSyncState = {
        paused: true,
        playbackRate: 1,
        timelineAnchorMs: 20_000,
        serverNowMs: 1_000,
        videoLoop: false,
      }
      const host = createHost({
        player,
        playback: { ...pausedSeek, videoLoop: "off" },
      })
      const engine = createPlaybackSyncEngine(host, scheduler)
      engine.start()

      engine.applyRoomClock(player, pausedSeek, 0)
      // Same-tick wrapper echo must not clear pending — media still at 5.
      expect(host.getPendingSync()).toEqual(pausedSeek)
      expect(mediaTime).toBe(5)

      accept = true
      engine.onAuthorityAnchor(20_000)
      advance(ANCHOR_RETRY_DELAYS_MS[0]!)
      expect(mediaTime).toBeCloseTo(20, 3)
      expect(host.getPendingSync()).toBeNull()
    })

    test("seek-while-paused escalate lands play-gated media seek", () => {
      const { scheduler } = createFakeScheduler(1_000)
      // Media only accepts currentTime while briefly playing (HLS paused no-op).
      let mediaTime = 5
      let playing = false
      let wrapperTime = 5
      let playCalls = 0
      const mediaEl = {
        muted: false,
        playbackRate: 1,
        get currentTime() {
          return mediaTime
        },
        set currentTime(value: number) {
          if (playing) mediaTime = value
        },
        get paused() {
          return !playing
        },
        pause() {
          playing = false
        },
        play() {
          playing = true
          playCalls += 1
          return Promise.resolve()
        },
      }
      const player: SyncablePlayer = {
        playbackRate: 1,
        duration: 5.05,
        seekableEnd: 5.01,
        paused: true,
        mediaEl,
        get currentTime() {
          return wrapperTime
        },
        set currentTime(value: number) {
          wrapperTime = value
        },
        pause() {
          this.paused = true
        },
        play() {
          this.paused = false
        },
      }
      const pausedSeek: EngineSyncState = {
        paused: true,
        playbackRate: 1,
        timelineAnchorMs: 20_000,
        serverNowMs: 1_000,
        videoLoop: false,
      }
      const host = createHost({
        player,
        playback: { ...pausedSeek, videoLoop: "off" },
      })
      const engine = createPlaybackSyncEngine(host, scheduler)
      engine.start()

      engine.applyRoomClock(player, pausedSeek, 0)
      expect(playCalls).toBe(1)
      expect(mediaTime).toBeCloseTo(20, 3)
      expect(mediaEl.paused).toBe(true)
      expect(host.getPendingSync()).toBeNull()
    })

    test("playing path does not escalate with muted play", () => {
      const { scheduler } = createFakeScheduler(1_000)
      const mediaTime = 5
      let playCalls = 0
      const mediaEl = {
        muted: false,
        playbackRate: 1,
        get currentTime() {
          return mediaTime
        },
        set currentTime(_value: number) {
          // no-op while "playing" session still stuck
        },
        paused: false,
        pause() {
          this.paused = true
        },
        play() {
          playCalls += 1
          this.paused = false
          return Promise.resolve()
        },
      }
      const player: SyncablePlayer = {
        playbackRate: 1,
        duration: 120,
        seekableEnd: 60,
        paused: false,
        mediaEl,
        currentTime: 5,
        pause() {
          this.paused = true
        },
        play() {
          this.paused = false
        },
      }
      const playingSeek: EngineSyncState = {
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 20_000,
        serverNowMs: 1_000,
        videoLoop: false,
      }
      const host = createHost({
        player,
        playback: { ...playingSeek, videoLoop: "off" },
      })
      const engine = createPlaybackSyncEngine(host, scheduler)
      engine.start()

      engine.applyRoomClock(player, playingSeek, 0)
      expect(playCalls).toBe(0)
      expect(host.getPendingSync()).toEqual(playingSeek)
    })

    test("late-join snap retries at threshold 0 until a no-op seek lands", () => {
      const sched = createFakeScheduler(10_000)
      const player = createMeasuredPlayer({
        now: () => sched.now,
        startSec: 0,
        acceptSeeks: false,
      })
      const state: EngineSyncState = {
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 19_000,
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
      expect(host.getPendingSync()).toEqual(state)

      // Still far behind: another authority apply must keep force-snapping
      // (initial snap is not consumed until convergence).
      engine.applyRoomClock(player, state)
      expect(player.mediaSeeks.length).toBe(2)

      player.setAccept(true)
      engine.applyRoomClock(player, state)
      expect(player.mediaEl!.currentTime).toBeCloseTo(
        19 + FORCE_SEEK_LEAD_SEC,
        3,
      )
      // Playing seek-confirm holds until a later sample shows playhead motion.
      expect(host.getPendingSync()).toEqual(state)
      sched.advance(ANCHOR_RETRY_DELAYS_MS[0]!)
      expect(host.getPendingSync()).not.toBeNull()
      sched.advance(ANCHOR_RETRY_DELAYS_MS[1]! - ANCHOR_RETRY_DELAYS_MS[0]!)
      expect(host.getPendingSync()).toBeNull()
    })

    test("playing dual-echo keeps pending until playhead advances", () => {
      const sched = createFakeScheduler(10_000)
      // Both wrapper and mediaEl accept the seek (dual echo) — the HLS late-join
      // failure mode where same-tick drift looks fine and pending was cleared.
      let mediaTime = 0
      let wrapperTime = 0
      let frozen = true
      let baseAtMs = 10_000
      const mediaEl = {
        muted: false,
        playbackRate: 1,
        paused: false,
        get currentTime() {
          if (frozen) return mediaTime
          return mediaTime + (sched.now - baseAtMs) / 1000
        },
        set currentTime(value: number) {
          mediaTime = value
          baseAtMs = sched.now
        },
        pause() {
          this.paused = true
        },
        play() {
          this.paused = false
          return Promise.resolve()
        },
      }
      const player: SyncablePlayer = {
        playbackRate: 1,
        duration: 600,
        paused: false,
        mediaEl,
        get currentTime() {
          if (frozen) return wrapperTime
          return wrapperTime + (sched.now - baseAtMs) / 1000
        },
        set currentTime(value: number) {
          wrapperTime = value
        },
        pause() {
          this.paused = true
        },
        play() {
          this.paused = false
        },
      }
      const state: EngineSyncState = {
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 19_000,
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
      const ledTarget = 19 + FORCE_SEEK_LEAD_SEC
      expect(mediaTime).toBeCloseTo(ledTarget, 3)
      expect(wrapperTime).toBeCloseTo(ledTarget, 3)
      expect(host.getPendingSync()).toEqual(state)

      // Freeze playhead past the min-confirm window — still pending (stale).
      sched.advance(ANCHOR_RETRY_DELAYS_MS[0]!)
      expect(host.getPendingSync()).toEqual(state)

      // Resume playhead motion: first verify records the near-target echo,
      // the next tick sees advance ≥ stale epsilon and clears pending.
      frozen = false
      baseAtMs = sched.now
      mediaTime = ledTarget
      wrapperTime = ledTarget
      sched.advance(ANCHOR_RETRY_DELAYS_MS[1]! - ANCHOR_RETRY_DELAYS_MS[0]!)
      expect(host.getPendingSync()).toBeNull()
      expect(mediaEl.currentTime).toBeGreaterThan(ledTarget)
    })

    test("playing dual-echo then lag with probe uses catch-up not hard seeks", () => {
      const sched = createFakeScheduler(10_000)
      let mediaTime = 0
      let wrapperTime = 0
      const seeks: number[] = []
      const mediaEl = {
        muted: false,
        paused: false,
        playbackRate: 1,
        get currentTime() {
          return mediaTime
        },
        set currentTime(value: number) {
          mediaTime = value
        },
        pause() {
          this.paused = true
        },
        play() {
          this.paused = false
          return Promise.resolve()
        },
      }
      const player: SyncablePlayer = {
        playbackRate: 1,
        duration: 600,
        paused: false,
        mediaEl,
        get currentTime() {
          return wrapperTime
        },
        set currentTime(value: number) {
          seeks.push(value)
          wrapperTime = value
        },
        pause() {
          this.paused = true
        },
        play() {
          this.paused = false
        },
      }
      const state: EngineSyncState = {
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 19_000,
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
      expect(seeks.at(-1)!).toBeCloseTo(19 + FORCE_SEEK_LEAD_SEC, 5)
      // Buffer stall eats the lead — playhead stuck at the authority clock.
      mediaTime = 19
      wrapperTime = 19
      expect(host.getPendingSync()).toEqual(state)
      const seeksAfterEcho = seeks.length

      // First tick into the catch-up band (short of the stall window) arms the
      // stall sample and prefers rate catch-up over another hard seek.
      sched.advance(1_200)
      const expectedRate = resolveCatchUpPlaybackRate(1, 1.2)
      expect(expectedRate).not.toBeNull()
      expect(player.playbackRate).toBeCloseTo(expectedRate!, 5)
      expect(mediaEl.playbackRate).toBeCloseTo(expectedRate!, 5)
      expect(seeks.length).toBe(seeksAfterEcho)
      expect(host.getPendingSync()).toEqual(state)
      expect(host.getCatchUpRate()).toBeCloseTo(expectedRate!, 5)

      // Playhead creeping while still lagging: stall does not escalate.
      mediaTime = 19.2
      wrapperTime = 19.2
      sched.advance(CATCH_UP_STALL_WINDOW_MS)
      expect(seeks.length).toBe(seeksAfterEcho)
      expect(host.getCatchUpRate()).not.toBeNull()
    })

    test("frozen playhead after seek does not escalate catch-up stall within post-seek grace", () => {
      const sched = createFakeScheduler(10_000)
      let mediaTime = 0
      let wrapperTime = 0
      const seeks: number[] = []
      const mediaEl = {
        muted: false,
        paused: false,
        playbackRate: 1,
        get currentTime() {
          return mediaTime
        },
        set currentTime(value: number) {
          mediaTime = value
        },
        pause() {
          this.paused = true
        },
        play() {
          this.paused = false
          return Promise.resolve()
        },
      }
      const player: SyncablePlayer = {
        playbackRate: 1,
        duration: 600,
        paused: false,
        mediaEl,
        get currentTime() {
          return wrapperTime
        },
        set currentTime(value: number) {
          seeks.push(value)
          wrapperTime = value
        },
        pause() {
          this.paused = true
        },
        play() {
          this.paused = false
        },
      }
      const state: EngineSyncState = {
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 19_000,
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
      expect(seeks.at(-1)!).toBeCloseTo(19 + FORCE_SEEK_LEAD_SEC, 5)
      mediaTime = 19
      wrapperTime = 19
      expect(host.getPendingSync()).toEqual(state)
      const seeksAfterEcho = seeks.length

      // Enter catch-up band; stall would arm here without post-seek grace.
      sched.advance(1_200)
      const expectedRate = resolveCatchUpPlaybackRate(1, 1.2)
      expect(expectedRate).not.toBeNull()
      expect(host.getCatchUpRate()).toBeCloseTo(expectedRate!, 5)
      expect(seeks.length).toBe(seeksAfterEcho)

      // Frozen past the stall window but still inside post-seek grace —
      // must not escalate (HLS/SC post-seek buffer fill looks frozen).
      sched.advance(CATCH_UP_STALL_WINDOW_MS)
      expect(host.getCatchUpRate()).not.toBeNull()
      expect(seeks.length).toBe(seeksAfterEcho)

      sched.advance(
        CATCH_UP_STALL_POST_SEEK_GRACE_MS -
          1_200 -
          CATCH_UP_STALL_WINDOW_MS -
          1,
      )
      expect(host.getCatchUpRate()).not.toBeNull()
      expect(seeks.length).toBe(seeksAfterEcho)
    })

    test("frozen playhead escalates catch-up stall after post-seek grace and stall window", () => {
      const sched = createFakeScheduler(10_000)
      let mediaTime = 0
      let wrapperTime = 0
      const seeks: number[] = []
      const mediaEl = {
        muted: false,
        paused: false,
        playbackRate: 1,
        get currentTime() {
          return mediaTime
        },
        set currentTime(value: number) {
          mediaTime = value
        },
        pause() {
          this.paused = true
        },
        play() {
          this.paused = false
          return Promise.resolve()
        },
      }
      const player: SyncablePlayer = {
        playbackRate: 1,
        duration: 600,
        paused: false,
        mediaEl,
        get currentTime() {
          return wrapperTime
        },
        set currentTime(value: number) {
          seeks.push(value)
          wrapperTime = value
        },
        pause() {
          this.paused = true
        },
        play() {
          this.paused = false
        },
      }
      const state: EngineSyncState = {
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 19_000,
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
      expect(seeks.at(-1)!).toBeCloseTo(19 + FORCE_SEEK_LEAD_SEC, 5)
      mediaTime = 19
      wrapperTime = 19
      expect(host.getPendingSync()).toEqual(state)
      const seeksAfterEcho = seeks.length

      // Frozen into the catch-up band, then creep through the rest of
      // post-seek grace so lag stays ~1.2s (avoid large-drift force seeks).
      sched.advance(1_200)
      expect(host.getCatchUpRate()).not.toBeNull()
      expect(seeks.length).toBe(seeksAfterEcho)

      let elapsed = 1_200
      while (elapsed < CATCH_UP_STALL_POST_SEEK_GRACE_MS) {
        const expectedSec = 19 + (sched.now - 10_000) / 1000
        mediaTime = expectedSec - 1.2
        wrapperTime = mediaTime
        const step = Math.min(200, CATCH_UP_STALL_POST_SEEK_GRACE_MS - elapsed)
        sched.advance(step)
        elapsed += step
      }
      {
        const expectedSec = 19 + (sched.now - 10_000) / 1000
        mediaTime = expectedSec - 1.2
        wrapperTime = mediaTime
      }
      expect(host.getCatchUpRate()).not.toBeNull()
      expect(seeks.length).toBe(seeksAfterEcho)

      // Freeze; next watchdog arms the stall sample (grace just ended).
      const frozenSec = mediaTime
      const armAt =
        Math.ceil(sched.now / WATCHDOG_INTERVAL_MS) * WATCHDOG_INTERVAL_MS
      sched.advance(armAt > sched.now ? armAt - sched.now : WATCHDOG_INTERVAL_MS)
      mediaTime = frozenSec
      wrapperTime = frozenSec
      expect(seeks.length).toBe(seeksAfterEcho)

      // Following watchdog (≥ stall window later) escalates to threshold-0
      // with playing seek lead.
      sched.advance(WATCHDOG_INTERVAL_MS)
      expect(host.getCatchUpRate()).toBeNull()
      expect(player.playbackRate).toBe(1)
      expect(seeks.length).toBeGreaterThan(seeksAfterEcho)
      expect(seeks.at(-1)!).toBeCloseTo(
        19 + (sched.now - 10_000) / 1000 + FORCE_SEEK_LEAD_SEC,
        1,
      )
      expect(host.getPendingSync()).toEqual(state)
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
      expect(player.mediaSeeks).toEqual([6 + FORCE_SEEK_LEAD_SEC])
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

      // Element starts accepting seeks; burst retry lands with playing lead,
      // then a subsequent tick confirms once the playhead advances.
      player.setAccept(true)
      sched.advance(ANCHOR_RETRY_DELAYS_MS[0]!)
      const room = pendingExpectedSec(state, sched.now)
      expect(player.mediaEl!.currentTime).toBeCloseTo(
        room + FORCE_SEEK_LEAD_SEC,
        1,
      )
      expect(host.getPendingSync()).not.toBeNull()
      sched.advance(ANCHOR_RETRY_DELAYS_MS[2]! - ANCHOR_RETRY_DELAYS_MS[0]!)
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
      // Clock seek + muted play→seek→pause escalate (media still no-ops).
      expect(player.seeks).toEqual([90, 90])
      expect(player.mediaSeeks).toEqual([90, 90])

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
