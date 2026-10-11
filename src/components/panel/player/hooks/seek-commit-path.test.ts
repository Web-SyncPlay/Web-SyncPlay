import { describe, expect, test } from "bun:test"
import { createRoomState } from "@/shared/test-utils/room-fixtures"
import { createPlaybackActions } from "../playback-control/use-playback-actions"
import { createTransportRequestHandlers } from "./create-transport-request-handlers"

/**
 * MP4 / native mid-seek: Vidstack seek-request → commitSeek → `playback:seek`
 * with `targetMs` (the only authoritative end-scrub message).
 */
function createWiredHandlers(config: { seekPhase: "idle" | "previewing" }) {
  const sent: Array<{ type: string; payload: unknown }> = []
  const roomState = createRoomState()
  const send = ((type: string, payload: unknown) => {
    sent.push({ type, payload })
  }) as never
  const actions = createPlaybackActions({
    roomState,
    send,
    controlsDisabled: false,
    elapsedMs: 0,
  } as never)

  const handlers = createTransportRequestHandlers({
    canControlPlayback: true,
    enforceServerPlaybackState: () => {},
    playbackRef: { current: roomState.playback },
    send,
    getCurrentTimeMs: () => 0,
    seekPhase: config.seekPhase,
    beginSeek: actions.beginSeek,
    updateSeek: actions.updateSeek,
    commitSeek: actions.commitSeek,
    commitLiveEdgeSeek: () => {},
  })
  return { handlers, sent }
}

describe("seek commit path", () => {
  test("onMediaSeekRequest sends playback:seek with floored targetMs", () => {
    const { handlers, sent } = createWiredHandlers({ seekPhase: "previewing" })
    handlers.onMediaSeekRequest(73.9876)
    expect(sent.filter((e) => e.type === "playback:seek")).toEqual([
      { type: "playback:seek", payload: { targetMs: 73_987 } },
    ])
  })

  test("negative / zero seek targets clamp to 0 ms", () => {
    const { handlers, sent } = createWiredHandlers({ seekPhase: "idle" })
    handlers.onMediaSeekRequest(-4)
    handlers.onMediaSeekRequest(0)
    expect(
      sent.filter((e) => e.type === "playback:seek").map((e) => e.payload),
    ).toEqual([{ targetMs: 0 }, { targetMs: 0 }])
  })

  test("scrub preview never sends playback:seek before commit", () => {
    const { handlers, sent } = createWiredHandlers({ seekPhase: "idle" })
    handlers.onMediaSeekingRequest(10)
    expect(sent.some((e) => e.type === "playback:seek")).toBe(false)
    expect(sent.some((e) => e.type === "seek:preview")).toBe(true)
  })
})
