import { describe, expect, test } from "bun:test"
import {
  applyPlaybackClockToPlayer,
  applyPlaybackSyncToPlayer,
  escalateSeekWhilePaused,
  isHlsWrapperMediaEcho,
  isSyncablePlayerPlaying,
  nudgePlaybackTransport,
} from "./apply-playback-sync"
import {
  DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
  FORCE_SEEK_LEAD_SEC,
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

describe("applyPlaybackClockToPlayer", () => {
  test("seeks and sets rate without touching transport", () => {
    const order: string[] = []
    let currentTime = 0
    const player = {
      playbackRate: 1,
      get currentTime() {
        return currentTime
      },
      set currentTime(value: number) {
        currentTime = value
        order.push(`seek:${value}`)
      },
      pause() {
        order.push("pause")
      },
      play() {
        order.push("play")
      },
    }

    applyPlaybackClockToPlayer({
      player,
      syncState: {
        paused: false,
        playbackRate: 1.5,
        timelineAnchorMs: 5_000,
        serverNowMs: 100,
      },
      nowMs: 100,
      driftThresholdSec: DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
    })

    expect(order).toEqual(["seek:5"])
    expect(player.playbackRate).toBe(1.5)
  })

  test("effectivePlaybackRate overrides room rate write", () => {
    const player = {
      playbackRate: 1,
      currentTime: 5,
    }
    applyPlaybackClockToPlayer({
      player,
      syncState: {
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 5_000,
        serverNowMs: 100,
      },
      nowMs: 100,
      effectivePlaybackRate: 1.15,
    })
    expect(player.playbackRate).toBe(1.15)
  })

  test("writes catch-up rate to mediaEl when present", () => {
    const mediaEl = stubMediaEl({ currentTime: 5 })
    const player = {
      playbackRate: 1,
      currentTime: 5,
      mediaEl,
    }
    applyPlaybackClockToPlayer({
      player,
      syncState: {
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 5_000,
        serverNowMs: 100,
      },
      nowMs: 100,
      effectivePlaybackRate: 1.15,
    })
    expect(player.playbackRate).toBe(1.15)
    expect(mediaEl.playbackRate).toBe(1.15)
  })

  test("skips seek when within drift threshold", () => {
    const order: string[] = []
    let currentTime = 1.2
    const player = {
      playbackRate: 1,
      get currentTime() {
        return currentTime
      },
      set currentTime(value: number) {
        currentTime = value
        order.push(`seek:${value}`)
      },
    }

    applyPlaybackClockToPlayer({
      player,
      syncState: {
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 1_000,
        serverNowMs: 1_000,
      },
      nowMs: 1_000,
      driftThresholdSec: DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
    })

    expect(order).toEqual([])
  })

  test("clamps seek to just before duration when clock is past EOF", () => {
    const order: string[] = []
    let currentTime = 0
    const player = {
      playbackRate: 1,
      duration: 10,
      get currentTime() {
        return currentTime
      },
      set currentTime(value: number) {
        currentTime = value
        order.push(`seek:${value}`)
      },
    }

    applyPlaybackClockToPlayer({
      player,
      syncState: {
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 12_000,
        serverNowMs: 100,
      },
      nowMs: 100,
      driftThresholdSec: DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
    })

    expect(order).toEqual(["seek:9.95"])
  })

  test("does not clamp VOD seeks to a short buffered seekable range", () => {
    const order: string[] = []
    let currentTime = 5
    const mediaEl = stubMediaEl({ currentTime: 5 })
    const player = {
      playbackRate: 1,
      duration: 120,
      seekableEnd: 15, // buffered window only
      mediaEl,
      get currentTime() {
        return currentTime
      },
      set currentTime(value: number) {
        currentTime = value
        order.push(`seek:${value}`)
      },
    }

    applyPlaybackClockToPlayer({
      player,
      syncState: {
        paused: true,
        playbackRate: 1,
        timelineAnchorMs: 20_000,
        serverNowMs: 100,
      },
      nowMs: 100,
      driftThresholdSec: 0,
    })

    expect(order).toEqual(["seek:20"])
    expect(mediaEl.currentTime).toBe(20)
  })

  test("false-live Infinity + short seekable still seeks to room anchor", () => {
    // HLS without ENDLIST: duration=Infinity, seekable≈5s, room at 20s.
    const order: string[] = []
    let currentTime = 5
    const mediaEl = stubMediaEl({ currentTime: 5 })
    const player = {
      playbackRate: 1,
      duration: Number.POSITIVE_INFINITY,
      seekableEnd: 5.2,
      mediaEl,
      get currentTime() {
        return currentTime
      },
      set currentTime(value: number) {
        currentTime = value
        order.push(`seek:${value}`)
      },
    }

    applyPlaybackClockToPlayer({
      player,
      syncState: {
        paused: true,
        playbackRate: 1,
        timelineAnchorMs: 20_000,
        serverNowMs: 100,
      },
      nowMs: 100,
      driftThresholdSec: 0,
    })

    expect(order).toEqual(["seek:20"])
    expect(mediaEl.currentTime).toBe(20)
    // Drift must stay against the unclamped room clock (not seekable 5.2).
    expect(
      applyPlaybackClockToPlayer({
        player,
        syncState: {
          paused: true,
          playbackRate: 1,
          timelineAnchorMs: 20_000,
          serverNowMs: 100,
        },
        nowMs: 100,
        driftThresholdSec: 0,
      }).driftSec,
    ).toBe(0)
  })

  test("write clamps to trusted EOF while returned drift uses EOF exception", () => {
    let currentTime = 0
    const player = {
      playbackRate: 1,
      duration: 10,
      get currentTime() {
        return currentTime
      },
      set currentTime(value: number) {
        currentTime = value
      },
    }

    const result = applyPlaybackClockToPlayer({
      player,
      syncState: {
        paused: true,
        playbackRate: 1,
        timelineAnchorMs: 12_000,
        serverNowMs: 100,
      },
      nowMs: 100,
      driftThresholdSec: 0,
    })

    expect(result.targetSec).toBeCloseTo(9.95, 5)
    expect(currentTime).toBeCloseTo(9.95, 5)
    expect(result.driftSec).toBeLessThanOrEqual(
      DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
    )
  })

  test("prefers seekableEnd over a lagging duration for live/DVR", () => {
    const order: string[] = []
    let currentTime = 40
    const mediaEl = stubMediaEl({ currentTime: 40 })
    const player = {
      playbackRate: 1,
      duration: 40,
      seekableEnd: 52,
      mediaEl,
      get currentTime() {
        return currentTime
      },
      set currentTime(value: number) {
        currentTime = value
        order.push(`seek:${value}`)
      },
    }

    applyPlaybackClockToPlayer({
      player,
      syncState: {
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 50_000,
        serverNowMs: 100,
      },
      nowMs: 100,
      driftThresholdSec: DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
    })

    expect(order).toEqual(["seek:50"])
    expect(mediaEl.currentTime).toBe(50)
  })
})

describe("escalateSeekWhilePaused", () => {
  test("muted play→seek→pause moves a play-gated media element", () => {
    let mediaTime = 5
    let playing = false
    const mediaEl = {
      muted: false,
      playbackRate: 1,
      get paused() {
        return !playing
      },
      get currentTime() {
        return mediaTime
      },
      set currentTime(value: number) {
        if (playing) mediaTime = value
      },
      pause() {
        playing = false
      },
      play() {
        playing = true
        return Promise.resolve()
      },
    }
    let wrapperTime = 5
    const player = {
      mediaEl,
      get currentTime() {
        return wrapperTime
      },
      set currentTime(value: number) {
        wrapperTime = value
      },
      pause() {},
      play() {},
    }

    escalateSeekWhilePaused({ player, targetSec: 20 })

    expect(mediaTime).toBe(20)
    expect(wrapperTime).toBe(20)
    expect(mediaEl.paused).toBe(true)
    expect(mediaEl.muted).toBe(false)
  })
})

describe("isHlsWrapperMediaEcho", () => {
  test("true when wrapper near reference but mediaEl is far", () => {
    expect(
      isHlsWrapperMediaEcho({
        mediaSec: 5,
        wrapperSec: 20.1,
        referenceSec: 20,
        thresholdSec: 0.8,
      }),
    ).toBe(true)
  })

  test("false when both near or both far", () => {
    expect(
      isHlsWrapperMediaEcho({
        mediaSec: 20,
        wrapperSec: 20.1,
        referenceSec: 20,
      }),
    ).toBe(false)
    expect(
      isHlsWrapperMediaEcho({
        mediaSec: 5,
        wrapperSec: 5.1,
        referenceSec: 20,
      }),
    ).toBe(false)
  })

  test("false when mediaEl is absent (null must not become 0)", () => {
    expect(
      isHlsWrapperMediaEcho({
        mediaSec: null,
        wrapperSec: 20,
        referenceSec: 20,
      }),
    ).toBe(false)
  })
})

describe("isSyncablePlayerPlaying", () => {
  test("trusts mediaEl when wrapper falsely reports playing", () => {
    expect(
      isSyncablePlayerPlaying({
        paused: false,
        mediaEl: { paused: true } as HTMLMediaElement,
      }),
    ).toBe(false)
  })

  test("trusts mediaEl when wrapper falsely reports paused", () => {
    expect(
      isSyncablePlayerPlaying({
        paused: true,
        mediaEl: { paused: false } as HTMLMediaElement,
      }),
    ).toBe(true)
  })

  test("falls back to wrapper when mediaEl is absent", () => {
    expect(isSyncablePlayerPlaying({ paused: false })).toBe(true)
    expect(isSyncablePlayerPlaying({ paused: true })).toBe(false)
  })
})

describe("nudgePlaybackTransport", () => {
  test("plays only when local is paused and room wants play", () => {
    const order: string[] = []
    const player = {
      paused: true,
      pause() {
        order.push("pause")
        this.paused = true
      },
      play() {
        order.push("play")
        this.paused = false
      },
    }

    nudgePlaybackTransport({ player, paused: false })
    expect(order).toEqual(["play"])

    order.length = 0
    nudgePlaybackTransport({ player, paused: false })
    expect(order).toEqual([])
  })

  test("pauses when room wants pause", () => {
    const order: string[] = []
    const player = {
      paused: false,
      pause() {
        order.push("pause")
        this.paused = true
      },
      play() {
        order.push("play")
        this.paused = false
      },
    }

    nudgePlaybackTransport({ player, paused: true })
    expect(order).toEqual(["pause"])
  })
})

describe("applyPlaybackSyncToPlayer", () => {
  test("full mode seeks before playing", () => {
    const order: string[] = []
    let currentTime = 0
    const player = {
      playbackRate: 1,
      paused: true,
      get currentTime() {
        return currentTime
      },
      set currentTime(value: number) {
        currentTime = value
        order.push(`seek:${value}`)
      },
      pause() {
        order.push("pause")
      },
      play() {
        order.push("play")
        this.paused = false
      },
    }

    applyPlaybackSyncToPlayer({
      player,
      syncState: {
        paused: false,
        playbackRate: 1.5,
        timelineAnchorMs: 5_000,
        serverNowMs: 100,
      },
      nowMs: 100,
      mode: "full",
    })

    expect(order).toEqual(["seek:5", "play"])
    expect(player.playbackRate).toBe(1.5)
  })

  test("clock mode never plays or pauses", () => {
    const order: string[] = []
    const player = {
      playbackRate: 1,
      currentTime: 0,
      paused: true,
      pause() {
        order.push("pause")
      },
      play() {
        order.push("play")
      },
    }

    const result = applyPlaybackSyncToPlayer({
      player,
      syncState: {
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 0,
        serverNowMs: Date.now(),
      },
      mode: "clock",
    })

    expect(order).toEqual([])
    expect(result.playAttempt).toBeNull()
  })
})

describe("real playhead (media element) measurement", () => {
  test("seeks when the wrapper claims sync but the element is behind", () => {
    const wrapperWrites: number[] = []
    const mediaEl = stubMediaEl({ currentTime: 2 })
    const player = {
      playbackRate: 1,
      duration: 120,
      mediaEl,
      // Wrapper currentTime lies (already at the target).
      get currentTime() {
        return 30
      },
      set currentTime(value: number) {
        wrapperWrites.push(value)
      },
    }

    const result = applyPlaybackClockToPlayer({
      player,
      syncState: {
        paused: true,
        playbackRate: 1,
        timelineAnchorMs: 30_000,
        serverNowMs: 100,
      },
      nowMs: 100,
    })

    expect(result.seekAttempted).toBe(true)
    expect(wrapperWrites).toEqual([30])
    expect(mediaEl.currentTime).toBe(30)
    expect(result.driftSec).toBe(0)
  })

  test("still writes the media element when the wrapper setter throws", () => {
    const mediaEl = stubMediaEl({ currentTime: 0 })
    const player = {
      playbackRate: 1,
      duration: 120,
      mediaEl,
      get currentTime() {
        return 0
      },
      set currentTime(_value: number) {
        throw new Error("wrapper not seekable")
      },
    }

    const result = applyPlaybackClockToPlayer({
      player,
      syncState: {
        paused: true,
        playbackRate: 1,
        timelineAnchorMs: 12_000,
        serverNowMs: 100,
      },
      nowMs: 100,
    })

    expect(result.seekAttempted).toBe(true)
    expect(mediaEl.currentTime).toBe(12)
  })

  test("threshold 0 force-seeks a sub-threshold late-join offset", () => {
    const mediaEl = stubMediaEl({ currentTime: 5.5 })
    const player = {
      playbackRate: 1,
      duration: 120,
      mediaEl,
      currentTime: 5.5,
    }
    const syncState = {
      paused: false,
      playbackRate: 1,
      timelineAnchorMs: 6_000,
      serverNowMs: 100,
    }

    applyPlaybackClockToPlayer({ player, syncState, nowMs: 100 })
    expect(mediaEl.currentTime).toBe(5.5)

    applyPlaybackClockToPlayer({
      player,
      syncState,
      nowMs: 100,
      driftThresholdSec: 0,
    })
    expect(mediaEl.currentTime).toBe(6)
    expect(player.currentTime).toBe(6)
  })

  test("seekLeadSec writes expected+lead for playing force seeks (ceiling clamped)", () => {
    const mediaEl = stubMediaEl({ currentTime: 5.5 })
    const player = {
      playbackRate: 1,
      duration: 120,
      mediaEl,
      currentTime: 5.5,
    }
    const syncState = {
      paused: false,
      playbackRate: 1,
      timelineAnchorMs: 6_000,
      serverNowMs: 100,
    }

    const result = applyPlaybackClockToPlayer({
      player,
      syncState,
      nowMs: 100,
      driftThresholdSec: 0,
      seekLeadSec: FORCE_SEEK_LEAD_SEC,
      allowAheadSec: FORCE_SEEK_LEAD_SEC,
    })

    expect(result.seekAttempted).toBe(true)
    expect(mediaEl.currentTime).toBeCloseTo(6 + FORCE_SEEK_LEAD_SEC, 5)
    expect(player.currentTime).toBeCloseTo(6 + FORCE_SEEK_LEAD_SEC, 5)
    expect(result.targetSec).toBeCloseTo(6 + FORCE_SEEK_LEAD_SEC, 5)
    expect(result.driftSec).toBe(0)
  })

  test("seekLeadSec clamps to resolveSeekCeilingSec", () => {
    const mediaEl = stubMediaEl({ currentTime: 0 })
    const player = {
      playbackRate: 1,
      duration: 7,
      mediaEl,
      currentTime: 0,
    }
    applyPlaybackClockToPlayer({
      player,
      syncState: {
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 6_000,
        serverNowMs: 100,
      },
      nowMs: 100,
      driftThresholdSec: 0,
      seekLeadSec: FORCE_SEEK_LEAD_SEC,
    })
    // expected 6 + lead 2.5 = 8.5, ceiling ≈ 6.95
    expect(mediaEl.currentTime).toBeCloseTo(6.95, 5)
  })

  test("seekLeadSec does not apply on paused seeks", () => {
    const mediaEl = stubMediaEl({ currentTime: 0 })
    const player = {
      playbackRate: 1,
      duration: 120,
      mediaEl,
      currentTime: 0,
    }
    applyPlaybackClockToPlayer({
      player,
      syncState: {
        paused: true,
        playbackRate: 1,
        timelineAnchorMs: 6_000,
        serverNowMs: 100,
      },
      nowMs: 100,
      driftThresholdSec: 0,
      // Caller must not pass lead for paused; verify unled write when lead is 0.
      seekLeadSec: 0,
    })
    expect(mediaEl.currentTime).toBe(6)
  })

  test("allowAheadSec keeps soft seeks from undoing a prior lead", () => {
    const mediaEl = stubMediaEl({ currentTime: 8.5 })
    const player = {
      playbackRate: 1,
      duration: 120,
      mediaEl,
      currentTime: 8.5,
    }
    const result = applyPlaybackClockToPlayer({
      player,
      syncState: {
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 6_000,
        serverNowMs: 100,
      },
      nowMs: 100,
      driftThresholdSec: DEFAULT_PLAYBACK_DRIFT_THRESHOLD_SEC,
      seekLeadSec: 0,
      allowAheadSec: FORCE_SEEK_LEAD_SEC,
    })
    expect(result.seekAttempted).toBe(false)
    expect(mediaEl.currentTime).toBe(8.5)
  })
})

describe("nudgePlaybackTransport when wrapper paused but element plays", () => {
  test("still pauses the media element (HLS declarative pause lie)", () => {
    const mediaEl = stubMediaEl({ currentTime: 10, paused: false })
    const pauseCalls: string[] = []
    const player = {
      paused: true, // Vidstack wrapper already flipped from paused={roomPaused}
      mediaEl,
      pause() {
        pauseCalls.push("wrapper")
        this.paused = true
      },
      play() {
        pauseCalls.push("play")
        this.paused = false
      },
    }

    nudgePlaybackTransport({ player, paused: true })
    expect(pauseCalls).toEqual(["wrapper"])
    expect(mediaEl.paused).toBe(true)
  })
})

describe("nudgePlaybackTransport pause", () => {
  test("re-issues pause even when the wrapper already reports paused", () => {
    let pauseCalls = 0
    const mediaEl = stubMediaEl({ currentTime: 1, paused: false })
    const player = {
      paused: true as boolean | undefined,
      mediaEl,
      pause() {
        pauseCalls += 1
        this.paused = true
      },
      play: () => {},
    }
    nudgePlaybackTransport({ player, paused: true })
    nudgePlaybackTransport({ player, paused: true })
    // Always re-issue: local blob / relay / HLS may ignore the first pause().
    expect(pauseCalls).toBe(2)
    expect(mediaEl.paused).toBe(true)
  })
})
