import { createRoomState } from "@/shared/test-utils/room-fixtures"
import { describe, expect, mock, test } from "bun:test"
import { createPlaybackLifecycleHandlers } from "./create-playback-lifecycle-handlers"
import { markTransportIntent, type TransportIntent } from "./transport-intent"
import { isVolumeSettling } from "./use-player-volume"

function createDeps(config: {
  roomPaused: boolean
  player?: { volume: number; muted: boolean; paused?: boolean }
  preferredVolume?: number
  isMediaReadyRef?: { current: boolean }
}) {
  const enforceServerPlaybackState = mock(() => {})
  const transportIntentRef: { current: TransportIntent | null } = {
    current: null,
  }
  const isMediaReadyRef = config.isMediaReadyRef ?? { current: true }
  const handlers = createPlaybackLifecycleHandlers({
    playerRef: { current: (config.player as never) ?? null },
    current: undefined,
    canControlPlayback: true,
    isMuted: false,
    preferredVolume: config.preferredVolume ?? 1,
    playbackRef: {
      current: { ...createRoomState().playback, paused: config.roomPaused },
    },
    transportIntentRef,
    isMediaReadyRef,
    bufferingSinceRef: { current: null },
    participantStatusErrorRef: { current: null },
    pendingSyncRef: { current: null },
    reportedItemErrorRef: { current: null },
    awaitingSeekTargetMs: null,
    send: (() => {}) as never,
    applyRoomClock: () => {},
    enforceServerPlaybackState,
    setIsBuffering: () => {},
    setPlaybackError: () => {},
  })
  return {
    handlers,
    enforceServerPlaybackState,
    transportIntentRef,
    isMediaReadyRef,
  }
}

describe("createPlaybackLifecycleHandlers transport intent", () => {
  test("onPause enforces when room is playing and no intent is in flight", () => {
    const { handlers, enforceServerPlaybackState } = createDeps({
      roomPaused: false,
    })
    handlers.onPause()
    expect(enforceServerPlaybackState).toHaveBeenCalledTimes(1)
  })

  test("onPause skips enforce while a pause intent is in flight", () => {
    const { handlers, enforceServerPlaybackState, transportIntentRef } =
      createDeps({ roomPaused: false })
    markTransportIntent(transportIntentRef, true)
    handlers.onPause()
    expect(enforceServerPlaybackState).not.toHaveBeenCalled()
  })

  test("onPause enforces again once the pause intent window expires", () => {
    const { handlers, enforceServerPlaybackState, transportIntentRef } =
      createDeps({ roomPaused: false })
    markTransportIntent(transportIntentRef, true, Date.now() - 5_000)
    handlers.onPause()
    expect(enforceServerPlaybackState).toHaveBeenCalledTimes(1)
  })

  test("onPlaying skips enforce while a play intent is in flight", () => {
    const { handlers, enforceServerPlaybackState, transportIntentRef } =
      createDeps({ roomPaused: true })
    markTransportIntent(transportIntentRef, false)
    handlers.onPlaying()
    expect(enforceServerPlaybackState).not.toHaveBeenCalled()
  })

  test("late playing after authority pause still re-asserts pause", () => {
    const { handlers, enforceServerPlaybackState, transportIntentRef } =
      createDeps({ roomPaused: true })
    // Pause intent already converged (room paused) → must not suppress.
    markTransportIntent(transportIntentRef, true)
    handlers.onPlaying()
    expect(enforceServerPlaybackState).toHaveBeenCalledTimes(1)
  })

  test("a pause intent does not suppress playing-against-pause enforce", () => {
    const { handlers, enforceServerPlaybackState, transportIntentRef } =
      createDeps({ roomPaused: true })
    markTransportIntent(transportIntentRef, false)
    markTransportIntent(transportIntentRef, true)
    handlers.onPlaying()
    expect(enforceServerPlaybackState).toHaveBeenCalledTimes(1)
  })
})

describe("createPlaybackLifecycleHandlers onCanPlay volume", () => {
  test("applies preferred volume before flipping mediaReady and arms settling", () => {
    let volume = 1
    let readyWhenVolumeSet = true
    const isMediaReadyRef = { current: false }
    const player = {
      muted: false,
      paused: true,
      get volume() {
        return volume
      },
      set volume(value: number) {
        volume = value
        readyWhenVolumeSet = isMediaReadyRef.current
      },
    }
    const { handlers } = createDeps({
      roomPaused: true,
      player,
      preferredVolume: 0.4,
      isMediaReadyRef,
    })

    handlers.onCanPlay()

    expect(volume).toBe(0.4)
    expect(readyWhenVolumeSet).toBe(false)
    expect(isMediaReadyRef.current).toBe(true)
    expect(isVolumeSettling(isMediaReadyRef)).toBe(true)
  })
})
