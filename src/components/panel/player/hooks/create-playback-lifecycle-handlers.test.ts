import { describe, expect, mock, test } from "bun:test"
import { createRoomState } from "@/shared/test-utils/room-fixtures"
import { createPlaybackLifecycleHandlers } from "./create-playback-lifecycle-handlers"
import {
  markTransportIntent,
  type TransportIntent,
} from "./transport-intent"

function createDeps(config: { roomPaused: boolean }) {
  const enforceServerPlaybackState = mock(() => {})
  const transportIntentRef: { current: TransportIntent | null } = {
    current: null,
  }
  const handlers = createPlaybackLifecycleHandlers({
    playerRef: { current: null },
    current: undefined,
    canControlPlayback: true,
    isMuted: false,
    preferredVolume: 1,
    playbackRef: {
      current: { ...createRoomState().playback, paused: config.roomPaused },
    },
    transportIntentRef,
    isMediaReadyRef: { current: true },
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
  return { handlers, enforceServerPlaybackState, transportIntentRef }
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
