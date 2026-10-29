import { describe, expect, mock, test } from "bun:test"

import type { LoopMode } from "@/contracts/types"
import { createRoomState } from "@/shared/test-utils/room-fixtures"

import type { LocalSeekPhase } from "../playback-control/use-playback-timeline-controller"
import { createTransportRequestHandlers } from "./create-transport-request-handlers"
import {
  isTransportIntentInFlight,
  type TransportIntent,
} from "./transport-intent"

function createDeps(
  overrides: {
    canControlPlayback?: boolean
    paused?: boolean
    playbackRate?: number
    videoLoop?: LoopMode
    seekPhase?: LocalSeekPhase
    /** Live element paused flag; `undefined` = no player mounted. */
    elementPaused?: boolean
  } = {},
) {
  const sent: Array<{ type: string; payload: unknown }> = []
  const enforceServerPlaybackState = mock(() => {})
  const beginSeek = mock((ms: number) => {
    void ms
  })
  const updateSeek = mock((ms: number) => {
    void ms
  })
  const commitSeek = mock((ms: number) => {
    void ms
  })
  const commitLiveEdgeSeek = mock(() => {})
  const clearTransportNudge = mock(() => {})
  const transportIntentRef: { current: TransportIntent | null } = {
    current: null,
  }

  const handlers = createTransportRequestHandlers({
    playerRef: {
      current:
        overrides.elementPaused === undefined
          ? null
          : ({ paused: overrides.elementPaused, el: null } as never),
    },
    canControlPlayback: overrides.canControlPlayback ?? true,
    enforceServerPlaybackState,
    clearTransportNudge,
    transportIntentRef,
    playbackRef: {
      current: {
        ...createRoomState().playback,
        paused: overrides.paused ?? false,
        playbackRate: overrides.playbackRate ?? 1,
        videoLoop: overrides.videoLoop ?? "off",
      },
    },
    send: ((type: string, payload: unknown) => {
      sent.push({ type, payload })
    }) as never,
    getCurrentTimeMs: () => 12_500,
    seekPhase: overrides.seekPhase ?? "idle",
    beginSeek,
    updateSeek,
    commitSeek,
    commitLiveEdgeSeek,
  })

  return {
    handlers,
    sent,
    enforceServerPlaybackState,
    clearTransportNudge,
    transportIntentRef,
    beginSeek,
    updateSeek,
    commitSeek,
    commitLiveEdgeSeek,
  }
}

describe("createTransportRequestHandlers", () => {
  test("blocks guest keyboard shortcuts except volume keys", () => {
    const { handlers } = createDeps({ canControlPlayback: false })
    const blocked = mock(() => {})
    const event = {
      key: " ",
      preventDefault: blocked,
      stopPropagation: blocked,
    }
    handlers.onKeyDownCapture(event)
    expect(blocked).toHaveBeenCalledTimes(2)

    const allowed = mock(() => {})
    handlers.onKeyDownCapture({
      key: "ArrowUp",
      preventDefault: allowed,
      stopPropagation: allowed,
    })
    expect(allowed).not.toHaveBeenCalled()
  })

  test("guest play/pause requests re-sync instead of sending", () => {
    const { handlers, sent, enforceServerPlaybackState } = createDeps({
      canControlPlayback: false,
      paused: true,
    })
    const preventDefault = mock(() => {})
    handlers.onMediaPlayRequest({ preventDefault })
    handlers.onMediaPauseRequest({ preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(2)
    expect(enforceServerPlaybackState).toHaveBeenCalledTimes(2)
    expect(sent).toHaveLength(0)
  })

  test("guest pause on a playing room never sends and re-syncs (NC-10)", () => {
    const { handlers, sent, enforceServerPlaybackState } = createDeps({
      canControlPlayback: false,
      paused: false,
    })
    const preventDefault = mock(() => {})
    handlers.onMediaPauseRequest({ preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(enforceServerPlaybackState).toHaveBeenCalledTimes(1)
    expect(sent).toHaveLength(0)
  })

  test("guest cannot send any playback mutation through transport handlers", () => {
    const g = createDeps({ canControlPlayback: false, paused: false })
    const preventDefault = mock(() => {})
    g.handlers.onMediaPlayRequest({ preventDefault })
    g.handlers.onMediaPauseRequest({ preventDefault })
    g.handlers.onMediaSeekingRequest(5)
    g.handlers.onMediaSeekRequest(5)
    g.handlers.onMediaLiveEdgeRequest()
    g.handlers.onMediaRateChangeRequest(2)
    g.handlers.onMediaUserLoopChangeRequest(true)
    expect(g.sent).toHaveLength(0)
    expect(g.beginSeek).not.toHaveBeenCalled()
    expect(g.updateSeek).not.toHaveBeenCalled()
    expect(g.commitSeek).not.toHaveBeenCalled()
    expect(g.commitLiveEdgeSeek).not.toHaveBeenCalled()
    expect(g.enforceServerPlaybackState).toHaveBeenCalledTimes(7)
  })

  test("guest keyboard space/k are blocked (no local pause toggle)", () => {
    const { handlers } = createDeps({ canControlPlayback: false })
    for (const key of [" ", "k", "K", "MediaPlayPause"]) {
      const fn = mock(() => {})
      handlers.onKeyDownCapture({
        key,
        preventDefault: fn,
        stopPropagation: fn,
      })
      expect(fn).toHaveBeenCalledTimes(2)
    }
  })

  test("controller sends play/pause only on state transitions", () => {
    const play = createDeps({ paused: true })
    const playPrevent = mock(() => {})
    play.handlers.onMediaPlayRequest({ preventDefault: playPrevent })
    expect(play.sent).toEqual([
      { type: "playback:play", payload: { currentTimeMs: 12_500 } },
    ])

    const pause = createDeps({ paused: false })
    const pausePrevent = mock(() => {})
    pause.handlers.onMediaPauseRequest({ preventDefault: pausePrevent })
    expect(pause.sent).toEqual([
      { type: "playback:pause", payload: { currentTimeMs: 12_500 } },
    ])
  })

  test("pause is sent when room ref says paused but the element is playing", () => {
    const { handlers, sent, clearTransportNudge, transportIntentRef } =
      createDeps({ paused: true, elementPaused: false })
    handlers.onMediaPauseRequest({ preventDefault: mock(() => {}) })
    expect(sent).toEqual([
      { type: "playback:pause", payload: { currentTimeMs: 12_500 } },
    ])
    expect(clearTransportNudge).toHaveBeenCalledTimes(1)
    expect(transportIntentRef.current?.paused).toBe(true)
  })

  test("Vidstack (null, event) pause signature still preventDefaults and sends", () => {
    // Void media-*-request events often arrive as detail=null; the real event
    // is the second arg. Calling preventDefault on null must not abort the send.
    const { handlers, sent } = createDeps({
      paused: false,
      elementPaused: false,
    })
    const preventDefault = mock(() => {})
    handlers.onMediaPauseRequest(null, { preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(sent).toEqual([
      { type: "playback:pause", payload: { currentTimeMs: 12_500 } },
    ])
  })

  test("Vidstack (null, event) play signature still preventDefaults and sends", () => {
    const { handlers, sent } = createDeps({
      paused: true,
      elementPaused: true,
    })
    const preventDefault = mock(() => {})
    handlers.onMediaPlayRequest(null, { preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(sent).toEqual([
      { type: "playback:play", payload: { currentTimeMs: 12_500 } },
    ])
  })

  test("nested nativeEvent still preventDefaults", () => {
    const { handlers, sent } = createDeps({
      paused: false,
      elementPaused: false,
    })
    const preventDefault = mock(() => {})
    handlers.onMediaPauseRequest({ nativeEvent: { preventDefault } })
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(sent).toEqual([
      { type: "playback:pause", payload: { currentTimeMs: 12_500 } },
    ])
  })

  test("pause is skipped when room is paused and the element is paused", () => {
    const { handlers, sent, clearTransportNudge } = createDeps({
      paused: true,
      elementPaused: true,
    })
    handlers.onMediaPauseRequest({ preventDefault: mock(() => {}) })
    expect(sent).toHaveLength(0)
    expect(clearTransportNudge).not.toHaveBeenCalled()
  })

  test("play is sent when room ref says playing but the element is paused", () => {
    const { handlers, sent, clearTransportNudge, transportIntentRef } =
      createDeps({ paused: false, elementPaused: true })
    handlers.onMediaPlayRequest({ preventDefault: mock(() => {}) })
    expect(sent).toEqual([
      { type: "playback:play", payload: { currentTimeMs: 12_500 } },
    ])
    expect(clearTransportNudge).toHaveBeenCalledTimes(1)
    expect(transportIntentRef.current?.paused).toBe(false)
  })

  test("pause/play requests clear the transport nudge and mark intent in flight", () => {
    const pause = createDeps({ paused: false, elementPaused: false })
    pause.handlers.onMediaPauseRequest({ preventDefault: mock(() => {}) })
    expect(pause.clearTransportNudge).toHaveBeenCalledTimes(1)
    // Room still unpaused → intent suppresses the pause-enforce window.
    expect(
      isTransportIntentInFlight(pause.transportIntentRef, true, false),
    ).toBe(true)
    // Expires after ~1.8s.
    expect(
      isTransportIntentInFlight(
        pause.transportIntentRef,
        true,
        false,
        Date.now() + 2_000,
      ),
    ).toBe(false)

    const play = createDeps({ paused: true, elementPaused: true })
    play.handlers.onMediaPlayRequest({ preventDefault: mock(() => {}) })
    expect(play.clearTransportNudge).toHaveBeenCalledTimes(1)
    expect(
      isTransportIntentInFlight(play.transportIntentRef, false, true),
    ).toBe(true)
  })

  test("seeking maps seconds to ms and uses live edge for non-finite targets", () => {
    const idle = createDeps({ seekPhase: "idle" })
    idle.handlers.onMediaSeekingRequest(12.345)
    expect(idle.beginSeek).toHaveBeenCalledWith(12_345)
    expect(idle.updateSeek).not.toHaveBeenCalled()

    const preview = createDeps({ seekPhase: "previewing" })
    preview.handlers.onMediaSeekingRequest(1.2)
    expect(preview.updateSeek).toHaveBeenCalledWith(1_200)

    const guest = createDeps({ canControlPlayback: false })
    guest.handlers.onMediaSeekingRequest(5)
    expect(guest.enforceServerPlaybackState).toHaveBeenCalled()

    const live = createDeps()
    live.handlers.onMediaSeekingRequest(Number.NaN)
    expect(live.commitLiveEdgeSeek).toHaveBeenCalled()
  })

  test("seek commit and rate/loop changes", () => {
    const seek = createDeps()
    seek.handlers.onMediaSeekRequest(3.9)
    expect(seek.commitSeek).toHaveBeenCalledWith(3_900)

    const nested = createDeps()
    nested.handlers.onMediaSeekRequest({ detail: 12.5 })
    expect(nested.commitSeek).toHaveBeenCalledWith(12_500)

    seek.handlers.onMediaLiveEdgeRequest()
    expect(seek.commitLiveEdgeSeek).toHaveBeenCalledTimes(1)

    const rate = createDeps({ playbackRate: 1 })
    rate.handlers.onMediaRateChangeRequest(1.5)
    expect(rate.sent).toEqual([
      { type: "playback:rate", payload: { playbackRate: 1.5 } },
    ])

    const sameRate = createDeps({ playbackRate: 1.5 })
    sameRate.handlers.onMediaRateChangeRequest(1.5)
    expect(sameRate.sent).toHaveLength(0)

    const loop = createDeps({ videoLoop: "off" })
    loop.handlers.onMediaUserLoopChangeRequest(true)
    expect(loop.sent).toEqual([
      { type: "playback:loop:video", payload: { mode: "always" } },
    ])
  })
})
