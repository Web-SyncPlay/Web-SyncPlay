import { describe, expect, test } from "bun:test"
import type { SyncablePlayer } from "./apply-playback-sync"
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
    const timers: { id: number; due: number; ms: number; fn: () => void }[] =
      []
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
