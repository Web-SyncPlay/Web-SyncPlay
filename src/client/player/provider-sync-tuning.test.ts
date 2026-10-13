import { describe, expect, test } from "bun:test"
import type { SyncablePlayer } from "./apply-playback-sync"
import { FORCE_SEEK_LEAD_SEC } from "./playback-sync"
import {
  ANCHOR_RETRY_DELAYS_MS,
  createPlaybackSyncEngine,
  MAX_FORCE_SEEKS_PER_ANCHOR,
  type EngineSyncState,
  type PlaybackSnapshot,
  type PlaybackSyncEngineHost,
  type PlaybackSyncScheduler,
} from "./playback-sync-engine"
import {
  IFRAME_MAX_FORCE_SEEKS_PER_ANCHOR,
  IFRAME_PAUSE_RETRY_DELAYS_MS,
  IFRAME_RETRY_DELAYS_MS,
  resolveProviderSyncTuning,
  type ProviderSyncTuning,
} from "./provider-sync-tuning"

describe("resolveProviderSyncTuning", () => {
  test.each([
    "https://www.youtube.com/watch?v=abc",
    "https://youtu.be/abc",
    "https://www.youtube-nocookie.com/embed/abc",
    "https://vimeo.com/12345",
    "https://player.vimeo.com/video/12345",
  ])("returns iframe tuning for %s", (url) => {
    const tuning = resolveProviderSyncTuning(url)
    expect(tuning?.retryDelaysMs).toBe(IFRAME_RETRY_DELAYS_MS)
    expect(tuning?.pauseRetryDelaysMs).toBe(IFRAME_PAUSE_RETRY_DELAYS_MS)
    expect(tuning?.maxForceSeeksPerAnchor).toBe(
      IFRAME_MAX_FORCE_SEEKS_PER_ANCHOR,
    )
  })

  test.each([
    "https://example.com/stream/master.m3u8",
    "https://example.com/video.mp4",
    "blob:https://example.com/1234",
    "/api/media/proxy/abc",
    "",
    null,
    undefined,
  ])("returns undefined (HLS defaults) for %p", (url) => {
    expect(resolveProviderSyncTuning(url)).toBeUndefined()
  })

  test("iframe schedule is strictly longer than the HLS default", () => {
    const hlsLast = ANCHOR_RETRY_DELAYS_MS.at(-1)!
    expect(IFRAME_RETRY_DELAYS_MS.at(-1)!).toBeGreaterThan(hlsLast)
    expect(IFRAME_MAX_FORCE_SEEKS_PER_ANCHOR).toBeGreaterThan(
      MAX_FORCE_SEEKS_PER_ANCHOR,
    )
    expect(IFRAME_PAUSE_RETRY_DELAYS_MS[0]!).toBeLessThan(
      ANCHOR_RETRY_DELAYS_MS[0]!,
    )
    // Sorted ascending so the burst is monotonic.
    for (const list of [IFRAME_RETRY_DELAYS_MS, IFRAME_PAUSE_RETRY_DELAYS_MS]) {
      expect([...list]).toEqual([...list].sort((a, b) => a - b))
    }
  })
})

describe("engine honours provider sync tuning", () => {
  function createScheduler(startMs = 1_000) {
    let now = startMs
    let nextId = 1
    const timers: { id: number; due: number; ms: number; fn: () => void }[] = []
    const scheduler: PlaybackSyncScheduler = {
      nowMs: () => now,
      setTimeout: (fn, ms) => {
        const id = nextId++
        timers.push({ id, due: now + ms, ms, fn })
        return id
      },
      clearTimeout: (id) => {
        const idx = timers.findIndex((t) => t.id === id)
        if (idx >= 0) timers.splice(idx, 1)
      },
      setInterval: () => nextId++,
      clearInterval: () => {},
    }
    const advance = (ms: number) => {
      const target = now + ms
      for (;;) {
        const next = timers
          .filter((t) => t.due <= target)
          .sort((a, b) => a.due - b.due)[0]
        if (!next) {
          now = target
          return
        }
        now = next.due
        timers.splice(timers.indexOf(next), 1)
        next.fn()
      }
    }
    return { scheduler, advance, timers }
  }

  const pausedState: EngineSyncState = {
    paused: true,
    playbackRate: 1,
    timelineAnchorMs: 10_000,
    serverNowMs: 1_000,
    videoLoop: false,
  }

  /** Iframe-like player: ignores pause() until `acceptAtMs` on the clock. */
  function createIframePlayer(now: () => number, acceptAtMs: number) {
    const player: SyncablePlayer = {
      playbackRate: 1,
      duration: 600,
      paused: false,
      currentTime: 10,
      pause() {
        if (now() >= acceptAtMs) this.paused = true
      },
      play() {
        this.paused = false
      },
    }
    return player
  }

  function createHost(
    player: SyncablePlayer,
    tuning?: ProviderSyncTuning,
  ): PlaybackSyncEngineHost {
    const playback: PlaybackSnapshot = { ...pausedState, videoLoop: "off" }
    let pending: EngineSyncState | null = null
    let lastApplied: number | null = null
    let catchUpRate: number | null = null
    return {
      getPlayer: () => player,
      isMediaReady: () => true,
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
      isAuthorityPaused: () => true,
      getSyncTuning: () => tuning,
    }
  }

  test("without tuning, pause burst uses the default HLS schedule", () => {
    const { scheduler, timers } = createScheduler()
    const player = createIframePlayer(() => 0, Number.POSITIVE_INFINITY)
    const engine = createPlaybackSyncEngine(createHost(player), scheduler)
    engine.start()
    engine.applyRoomClock(player, pausedState, 0)

    const pauseDelays = timers.map((t) => t.ms).filter((ms) => ms !== 0)
    // 1 pause burst + 1 verify burst only when initial snap re-arms; the
    // pause burst alone must match the default schedule.
    for (const delay of ANCHOR_RETRY_DELAYS_MS) {
      expect(pauseDelays).toContain(delay)
    }
    expect(pauseDelays).not.toContain(IFRAME_RETRY_DELAYS_MS.at(-1)!)
    expect(pauseDelays).not.toContain(IFRAME_PAUSE_RETRY_DELAYS_MS[0]!)
  })

  test("with iframe tuning, pause burst uses the longer schedule", () => {
    const { scheduler, timers } = createScheduler()
    const player = createIframePlayer(() => 0, Number.POSITIVE_INFINITY)
    const engine = createPlaybackSyncEngine(
      createHost(player, resolveProviderSyncTuning("https://youtu.be/abc")),
      scheduler,
    )
    engine.start()
    engine.applyRoomClock(player, pausedState, 0)

    const delays = timers.map((t) => t.ms)
    for (const delay of IFRAME_PAUSE_RETRY_DELAYS_MS) {
      expect(delays).toContain(delay)
    }
  })

  test("iframe pause is re-nudged past the HLS burst window", () => {
    const { scheduler, advance } = createScheduler(0)
    const hlsEnd = ANCHOR_RETRY_DELAYS_MS.at(-1)!
    // Element only honours pause after the HLS burst has ended.
    const player = createIframePlayer(() => scheduler.nowMs(), hlsEnd + 1)
    const engine = createPlaybackSyncEngine(
      createHost(player, resolveProviderSyncTuning("https://vimeo.com/1")),
      scheduler,
    )
    engine.start()
    engine.applyRoomClock(player, pausedState, 0)
    expect(player.paused).toBe(false)

    advance(hlsEnd)
    expect(player.paused).toBe(false)

    advance(IFRAME_RETRY_DELAYS_MS.at(-1)! - hlsEnd)
    expect(player.paused).toBe(true)
  })

  test("HLS path stops the pause burst at the default schedule end", () => {
    const { scheduler, advance } = createScheduler(0)
    const hlsEnd = ANCHOR_RETRY_DELAYS_MS.at(-1)!
    const player = createIframePlayer(() => scheduler.nowMs(), hlsEnd + 1)
    const engine = createPlaybackSyncEngine(createHost(player), scheduler)
    engine.start()
    engine.applyRoomClock(player, pausedState, 0)

    // No watchdog in this fake scheduler: nothing retries after the burst.
    advance(IFRAME_RETRY_DELAYS_MS.at(-1)!)
    expect(player.paused).toBe(false)
  })
})

describe("native iframe pending / quiescence rules", () => {
  function createScheduler(startMs = 0) {
    let now = startMs
    let nextId = 1
    const timers: { id: number; due: number; ms: number; fn: () => void }[] = []
    const scheduler: PlaybackSyncScheduler = {
      nowMs: () => now,
      setTimeout: (fn, ms) => {
        const id = nextId++
        timers.push({ id, due: now + ms, ms, fn })
        return id
      },
      clearTimeout: (id) => {
        const idx = timers.findIndex((t) => t.id === id)
        if (idx >= 0) timers.splice(idx, 1)
      },
      setInterval: () => nextId++,
      clearInterval: () => {},
    }
    const advance = (ms: number) => {
      const target = now + ms
      for (;;) {
        const next = timers
          .filter((t) => t.due <= target)
          .sort((a, b) => a.due - b.due)[0]
        if (!next) {
          now = target
          return
        }
        now = next.due
        timers.splice(timers.indexOf(next), 1)
        next.fn()
      }
    }
    return { scheduler, advance }
  }

  const ANCHOR_MS = 19_000
  const pausedRoom: EngineSyncState = {
    paused: true,
    playbackRate: 1,
    timelineAnchorMs: ANCHOR_MS,
    serverNowMs: 0,
    videoLoop: false,
  }

  function createHarness(config: {
    player: SyncablePlayer
    url: string
    room?: EngineSyncState
    durationHintSec?: number | null
    scheduler: PlaybackSyncScheduler
  }) {
    const room = config.room ?? pausedRoom
    const playback: PlaybackSnapshot = { ...room, videoLoop: "off" }
    let pending: EngineSyncState | null = null
    let lastApplied: number | null = null
    let catchUpRate: number | null = null
    const host: PlaybackSyncEngineHost = {
      getPlayer: () => config.player,
      isMediaReady: () => true,
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
      isAuthorityPaused: () => room.paused,
      getSyncTuning: () => resolveProviderSyncTuning(config.url),
      getDurationHintSec: () => config.durationHintSec,
    }
    const engine = createPlaybackSyncEngine(host, config.scheduler)
    return { engine, host, room, getPending: () => pending }
  }

  /** Wrapper echoes the requested time at once (lying), `paused` is honest. */
  function createEchoPlayer(initialSec: number): SyncablePlayer & {
    seekWrites: number[]
  } {
    let time = initialSec
    const seekWrites: number[] = []
    return {
      playbackRate: 1,
      duration: 600,
      paused: true,
      seekWrites,
      get currentTime() {
        return time
      },
      set currentTime(value: number) {
        seekWrites.push(value)
        time = value
      },
      pause() {},
      play() {},
    }
  }

  test("wrapper-only HLS echo clears; native keeps pending until a later read", () => {
    // Without mediaEl, HLS cannot detect wrapper/media split-brain and treats
    // a same-tick playhead jump as confirmed (prod HLS always wires mediaEl).
    for (const [url, expectKept] of [
      ["https://example.com/live.m3u8", false],
      ["https://youtu.be/abc", true],
    ] as const) {
      const { scheduler, advance } = createScheduler(0)
      const player = createEchoPlayer(0)
      const { engine, getPending } = createHarness({ player, url, scheduler })
      engine.start()
      engine.applyRoomClock(player, pausedRoom)
      expect(player.seekWrites.at(-1)).toBe(19)
      expect(getPending() !== null).toBe(expectKept)

      if (expectKept) {
        // Seek may confirm on the first verify tick, but pause quiescence
        // still needs ≥1500ms of stable playhead before pending clears.
        advance(IFRAME_RETRY_DELAYS_MS[0]!)
        expect(getPending()).not.toBeNull()
        advance(IFRAME_RETRY_DELAYS_MS[3]! - IFRAME_RETRY_DELAYS_MS[0]!)
        expect(getPending()).toBeNull()
      }
    }
  })

  test("HTML5 dual-echo playing room keeps pending until playhead advances", () => {
    const { scheduler, advance } = createScheduler(0)
    let mediaTime = 0
    let wrapperTime = 0
    const mediaEl = {
      get currentTime() {
        return mediaTime
      },
      set currentTime(value: number) {
        mediaTime = value
      },
      paused: false,
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
    const player: SyncablePlayer = {
      playbackRate: 1,
      duration: 600,
      paused: false,
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
    const playingRoom: EngineSyncState = {
      paused: false,
      playbackRate: 1,
      timelineAnchorMs: ANCHOR_MS,
      serverNowMs: 0,
      videoLoop: false,
    }
    const { engine, getPending } = createHarness({
      player,
      url: "https://example.com/live.m3u8",
      room: playingRoom,
      scheduler,
    })
    engine.start()
    engine.applyRoomClock(player, playingRoom, 0)
    // HTML5 playing force-seek writes with seek lead.
    expect(mediaTime).toBe(19 + FORCE_SEEK_LEAD_SEC)
    expect(wrapperTime).toBe(19 + FORCE_SEEK_LEAD_SEC)
    expect(getPending()).not.toBeNull()

    // Frozen dual-echo: verify tick must not clear pending.
    advance(ANCHOR_RETRY_DELAYS_MS[0]!)
    expect(getPending()).not.toBeNull()
  })

  test("HLS keeps pending when wrapper echoes but mediaEl stays behind", () => {
    const { scheduler, advance } = createScheduler(0)
    let mediaTime = 5
    let wrapperTime = 5
    const mediaEl = {
      get currentTime() {
        return mediaTime
      },
      set currentTime(_value: number) {
        // no-op until unblock — false-live HLS seek-while-paused
      },
      paused: true,
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
    const { engine, getPending } = createHarness({
      player,
      url: "https://example.com/live.m3u8",
      scheduler,
    })
    engine.start()
    engine.applyRoomClock(player, pausedRoom)
    expect(wrapperTime).toBe(19)
    expect(mediaTime).toBe(5)
    expect(getPending()).not.toBeNull()

    // Unblock element; authority-anchor burst force-seeks to the room clock.
    Object.defineProperty(mediaEl, "currentTime", {
      get: () => mediaTime,
      set: (value: number) => {
        mediaTime = value
      },
      configurable: true,
    })
    engine.onAuthorityAnchor(pausedRoom.timelineAnchorMs)
    advance(ANCHOR_RETRY_DELAYS_MS[0]!)
    expect(mediaTime).toBeCloseTo(19, 3)
    expect(getPending()).toBeNull()
  })

  test("no-op iframe seek never clears pending across the retry burst", () => {
    const { scheduler, advance } = createScheduler(0)
    // Wrapper ignores seek writes entirely: playhead stays at 0.
    const player: SyncablePlayer = {
      playbackRate: 1,
      duration: 600,
      paused: true,
      currentTime: 0,
      pause() {},
      play() {},
    }
    Object.defineProperty(player, "currentTime", {
      get: () => 0,
      set: () => {},
    })
    const { engine, getPending } = createHarness({
      player,
      url: "https://vimeo.com/1",
      scheduler,
    })
    engine.start()
    engine.applyRoomClock(player, pausedRoom)
    for (const delay of IFRAME_RETRY_DELAYS_MS) {
      expect(getPending()).not.toBeNull()
      advance(delay)
    }
    advance(IFRAME_RETRY_DELAYS_MS.at(-1)!)
    expect(getPending()).not.toBeNull()
  })

  test("duration gate: seek is a no-op until duration is known, then re-applied", () => {
    const { scheduler } = createScheduler(0)
    const player = createEchoPlayer(0)
    player.duration = 0
    const { engine, getPending } = createHarness({
      player,
      url: "https://youtu.be/abc",
      scheduler,
    })
    engine.start()
    engine.applyRoomClock(player, pausedRoom)
    expect(player.seekWrites).toEqual([])
    expect(getPending()).not.toBeNull()

    // Duration arrives (onDurationChange) -> threshold-0 re-apply.
    player.duration = 120
    engine.onDurationAvailable()
    expect(player.seekWrites).toEqual([19])
  })

  test("duration gate opens from the catalog hint alone", () => {
    const { scheduler } = createScheduler(0)
    const player = createEchoPlayer(0)
    player.duration = 0
    const { engine } = createHarness({
      player,
      url: "https://youtu.be/abc",
      scheduler,
      durationHintSec: 120,
    })
    engine.start()
    engine.applyRoomClock(player, pausedRoom)
    expect(player.seekWrites).toEqual([19])
  })

  test("duration gate: verify burst re-applies once duration appears", () => {
    const { scheduler, advance } = createScheduler(0)
    const player = createEchoPlayer(0)
    player.duration = 0
    const { engine, getPending } = createHarness({
      player,
      url: "https://youtu.be/abc",
      scheduler,
    })
    engine.start()
    engine.applyRoomClock(player, pausedRoom)
    engine.onAuthorityAnchor(ANCHOR_MS)
    advance(IFRAME_RETRY_DELAYS_MS[0]!)
    expect(player.seekWrites).toEqual([])
    expect(getPending()).not.toBeNull()

    player.duration = 120
    advance(IFRAME_RETRY_DELAYS_MS[1]! - IFRAME_RETRY_DELAYS_MS[0]!)
    expect(player.seekWrites).toEqual([19])
  })

  test("HLS ignores the duration gate", () => {
    const { scheduler } = createScheduler(0)
    const player = createEchoPlayer(0)
    player.duration = 0
    const { engine } = createHarness({
      player,
      url: "https://example.com/video.mp4",
      scheduler,
    })
    engine.start()
    engine.applyRoomClock(player, pausedRoom)
    expect(player.seekWrites).toEqual([19])
  })

  test("room pause hard-seeks once, then repeats pause until quiescent (lying paused)", () => {
    const { scheduler, advance } = createScheduler(0)
    // Embed keeps playing past the paused flag: wrapper `paused` says true,
    // but the playhead advances until the provider honours pause() at 3s.
    const acceptPauseAtMs = 3_000
    let playingSinceMs: number | null = 0
    let baseSec = 10
    let pauseCalls = 0
    const read = () =>
      playingSinceMs === null
        ? baseSec
        : baseSec + (scheduler.nowMs() - playingSinceMs) / 1000
    const seekWrites: number[] = []
    const player: SyncablePlayer = {
      playbackRate: 1,
      duration: 600,
      paused: true,
      get currentTime() {
        return read()
      },
      set currentTime(value: number) {
        seekWrites.push(value)
        baseSec = value
        if (playingSinceMs !== null) playingSinceMs = scheduler.nowMs()
      },
      pause() {
        pauseCalls += 1
        if (scheduler.nowMs() >= acceptPauseAtMs && playingSinceMs !== null) {
          baseSec = read()
          playingSinceMs = null
        }
      },
      play() {},
    }
    const { engine, getPending } = createHarness({
      player,
      url: "https://youtu.be/abc",
      scheduler,
    })
    engine.start()
    engine.applyRoomClock(player, pausedRoom)

    // Threshold-0 seek to the pause anchor happened first.
    expect(seekWrites[0]).toBe(19)
    expect(pauseCalls).toBeGreaterThan(0)
    expect(getPending()).not.toBeNull()

    const callsAtStart = pauseCalls
    advance(2_400)
    // Still "playing" under a paused flag: keeps nudging, pending held.
    expect(pauseCalls).toBeGreaterThan(callsAtStart)
    expect(getPending()).not.toBeNull()

    // 4s burst accepts pause (≥ acceptPauseAtMs); next burst at 6s is the
    // first ≥1500ms stable sample that can clear pending.
    advance(4_000 - 2_400)
    expect(playingSinceMs).toBeNull()
    expect(getPending()).not.toBeNull()
    advance(2_000)
    expect(getPending()).toBeNull()
  })

  test("1Hz integer playhead keeps invoking pause while unsettled", () => {
    const { scheduler, advance } = createScheduler(0)
    // Vimeo-like: wrapper paused=true, currentTime only ticks once per second.
    // Quiescence false-settle is covered in native-provider-sync tests; here we
    // only assert the engine keeps calling pause() across short sample gaps.
    let originMs = 0
    let originSec = 10
    let pauseCalls = 0
    const player: SyncablePlayer = {
      playbackRate: 1,
      duration: 600,
      paused: true,
      get currentTime() {
        return originSec + Math.floor((scheduler.nowMs() - originMs) / 1000)
      },
      set currentTime(value: number) {
        originSec = value
        originMs = scheduler.nowMs()
      },
      pause() {
        pauseCalls += 1
      },
      play() {},
    }
    const { engine, getPending } = createHarness({
      player,
      url: "https://vimeo.com/12345",
      scheduler,
    })
    engine.start()
    engine.applyRoomClock(player, pausedRoom)

    const callsAtStart = pauseCalls
    advance(2_400)
    // Burst ticks still nudge pause; 1Hz grain must not clear pending early.
    expect(pauseCalls).toBeGreaterThan(callsAtStart)
    expect(getPending()).not.toBeNull()
  })

  test("HLS paused room does not sample quiescence (clears on paused flag)", () => {
    const { scheduler } = createScheduler(0)
    const player = createEchoPlayer(19)
    const { engine, getPending } = createHarness({
      player,
      url: "https://example.com/video.mp4",
      scheduler,
    })
    engine.start()
    engine.applyRoomClock(player, pausedRoom)
    expect(getPending()).toBeNull()
  })
})
