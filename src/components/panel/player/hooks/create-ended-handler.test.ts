import { createRoomState } from "@/shared/test-utils/room-fixtures"
import { describe, expect, mock, test } from "bun:test"
import {
  createEndedHandler,
  resolveEndedPauseCurrentTimeMs,
} from "./create-ended-handler"

function createDeps(config?: {
  canControlPlayback?: boolean
  paused?: boolean
  videoLoop?: "off" | "once" | "always"
  currentIndex?: number
  totalItems?: number
  playlistLoop?: "off" | "once" | "always"
  getCurrentTimeMs?: () => number
  durationSeconds?: number
  playerDuration?: number
  timelineAnchorMs?: number
  serverNowMs?: number
}) {
  const send = mock((_type: string, _payload: unknown) => {})
  const enforceServerPlaybackState = mock(() => {})
  const selectPlaylistIndex = mock((_index: number) => {})
  const now = Date.now()
  const room = createRoomState()
  room.playback = {
    ...room.playback,
    paused: config?.paused ?? false,
    videoLoop: config?.videoLoop ?? "off",
    playlistLoop: config?.playlistLoop ?? "off",
    timelineAnchorMs: config?.timelineAnchorMs ?? 18_500,
    serverNowMs: config?.serverNowMs ?? now,
  }

  const handlers = createEndedHandler({
    canControlPlayback: config?.canControlPlayback ?? true,
    enforceServerPlaybackState,
    playbackRef: { current: room.playback },
    playlistNavRef: {
      current: {
        currentIndex: config?.currentIndex ?? 0,
        playlistLoop: config?.playlistLoop ?? "off",
      },
    },
    totalItems: config?.totalItems ?? 1,
    send: send as never,
    getCurrentTimeMs: config?.getCurrentTimeMs ?? (() => 0),
    selectPlaylistIndex,
    current:
      config?.durationSeconds !== undefined
        ? ({
            id: "item-1",
            name: "clip",
            durationSeconds: config.durationSeconds,
          } as never)
        : undefined,
    playerRef: {
      current:
        config?.playerDuration !== undefined
          ? ({ duration: config.playerDuration } as never)
          : null,
    },
  })

  return { handlers, send, enforceServerPlaybackState, selectPlaylistIndex }
}

describe("resolveEndedPauseCurrentTimeMs", () => {
  test("prefers duration−ε over a zero YouTube ENDED playhead", () => {
    const now = 1_000_000
    const ms = resolveEndedPauseCurrentTimeMs({
      getCurrentTimeMs: () => 0,
      playbackRef: {
        current: {
          ...createRoomState().playback,
          paused: false,
          timelineAnchorMs: 18_000,
          serverNowMs: now,
        },
      },
      current: { durationSeconds: 19 } as never,
      playerRef: { current: null },
      nowMs: now,
    })
    // duration 19s − 0.05s → 18950; room projected at nowMs===serverNow is 18s
    expect(ms).toBe(18_950)
  })

  test("clamps room-projected past EOF down to duration−ε", () => {
    const now = 2_000_000
    const ms = resolveEndedPauseCurrentTimeMs({
      getCurrentTimeMs: () => 12_000,
      playbackRef: {
        current: {
          ...createRoomState().playback,
          paused: false,
          timelineAnchorMs: 17_000,
          serverNowMs: now - 3_000,
        },
      },
      current: undefined,
      playerRef: { current: { duration: 19 } as never },
      nowMs: now,
    })
    // playhead 12s, eof 18.95s, room projected 20s → clamp to eof
    expect(ms).toBe(18_950)
  })
})

describe("createEndedHandler", () => {
  test("guest ended enforces server state and does not pause", () => {
    const { handlers, send, enforceServerPlaybackState } = createDeps({
      canControlPlayback: false,
    })
    handlers.onEnded()
    expect(enforceServerPlaybackState).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
  })

  test("EOF pause does not publish currentTimeMs=0 when duration known", () => {
    const now = Date.now()
    const { handlers, send } = createDeps({
      getCurrentTimeMs: () => 0,
      durationSeconds: 19,
      timelineAnchorMs: 18_500,
      serverNowMs: now,
      totalItems: 1,
      currentIndex: 0,
      playlistLoop: "off",
      paused: false,
    })
    handlers.onEnded()
    expect(send).toHaveBeenCalledTimes(1)
    const [type, payload] = send.mock.calls[0]!
    expect(type).toBe("playback:pause")
    const currentTimeMs = (payload as { currentTimeMs: number }).currentTimeMs
    expect(currentTimeMs).toBeGreaterThan(0)
    // duration−ε wins over zero playhead; room ~18.5s when serverNow≈now
    expect(currentTimeMs).toBeGreaterThanOrEqual(18_500)
    expect(currentTimeMs).toBe(18_950)
  })

  test("advances playlist instead of pausing when a next item exists", () => {
    const { handlers, send, selectPlaylistIndex } = createDeps({
      totalItems: 2,
      currentIndex: 0,
      playlistLoop: "off",
    })
    handlers.onEnded()
    expect(selectPlaylistIndex).toHaveBeenCalledWith(1)
    expect(send).not.toHaveBeenCalled()
  })

  test("skips pause when already paused at EOF", () => {
    const { handlers, send } = createDeps({
      paused: true,
      getCurrentTimeMs: () => 0,
      durationSeconds: 19,
    })
    handlers.onEnded()
    expect(send).not.toHaveBeenCalled()
  })
})
