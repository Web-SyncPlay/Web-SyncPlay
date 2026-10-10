import { describe, expect, mock, test } from "bun:test"
import { createRoomState } from "@/shared/test-utils/room-fixtures"
import type { LoopMode } from "@/contracts/types"
import type { LocalSeekPhase } from "../playback-control/use-playback-timeline-controller"
import { createTransportRequestHandlers } from "./create-transport-request-handlers"

function createDeps(overrides: {
  canControlPlayback?: boolean
  paused?: boolean
  playbackRate?: number
  videoLoop?: LoopMode
  seekPhase?: LocalSeekPhase
} = {}) {
  const sent: Array<{ type: string; payload: unknown }> = []
  const enforceServerPlaybackState = mock(() => {})
  const beginSeek = mock((_ms: number) => {})
  const updateSeek = mock((_ms: number) => {})
  const commitSeek = mock((_ms: number) => {})
  const commitLiveEdgeSeek = mock(() => {})

  const handlers = createTransportRequestHandlers({
    canControlPlayback: overrides.canControlPlayback ?? true,
    enforceServerPlaybackState,
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
