import { createRoomState } from "@/shared/test-utils/room-fixtures"
import { describe, expect, mock, test } from "bun:test"
import {
  createPlaybackLifecycleHandlers,
  PLAYBACK_WAITING_GRACE_MS,
} from "./create-playback-lifecycle-handlers"
import { markTransportIntent, type TransportIntent } from "./transport-intent"
import { isVolumeSettling } from "./use-player-volume"

function createDeps(config: {
  roomPaused: boolean
  player?: { volume: number; muted: boolean; paused?: boolean }
  preferredVolume?: number
  isMediaReadyRef?: { current: boolean }
  applyRoomClock?: ReturnType<typeof mock>
  nowMs?: () => number
}) {
  const enforceServerPlaybackState = mock(() => {})
  const clearTransportNudge = mock(() => {})
  const setIsBuffering = mock((value: boolean) => {
    void value
  })
  const setPlaybackUnlocked = mock((value: boolean) => {
    void value
  })
  const setSuppressBufferingUi = mock((value: boolean) => {
    void value
  })
  const applyRoomClock = config.applyRoomClock ?? mock(() => {})
  const transportIntentRef: { current: TransportIntent | null } = {
    current: null,
  }
  const isMediaReadyRef = config.isMediaReadyRef ?? { current: true }
  const pendingSyncRef: { current: null | ReturnType<typeof Object> } = {
    current: null,
  }
  const bufferingSinceRef: { current: number | null } = { current: null }
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
    bufferingSinceRef,
    participantStatusErrorRef: { current: null },
    pendingSyncRef: pendingSyncRef as never,
    reportedItemErrorRef: { current: null },
    awaitingSeekTargetMs: null,
    send: (() => {}) as never,
    applyRoomClock: applyRoomClock as never,
    enforceServerPlaybackState,
    clearTransportNudge,
    setIsBuffering,
    setPlaybackUnlocked,
    setSuppressBufferingUi,
    setPlaybackError: () => {},
  })
  return {
    handlers,
    enforceServerPlaybackState,
    clearTransportNudge,
    transportIntentRef,
    isMediaReadyRef,
    applyRoomClock,
    setIsBuffering,
    setPlaybackUnlocked,
    setSuppressBufferingUi,
    bufferingSinceRef,
    pendingSyncRef,
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

describe("createPlaybackLifecycleHandlers unlock + waiting grace", () => {
  test("onCanPlay force-snaps while held paused then restores room pending", () => {
    const applyRoomClock = mock(() => {})
    const player = { volume: 1, muted: false, paused: true }
    const {
      handlers,
      clearTransportNudge,
      isMediaReadyRef,
      setPlaybackUnlocked,
      pendingSyncRef,
    } = createDeps({
      roomPaused: false,
      player,
      isMediaReadyRef: { current: false },
      applyRoomClock,
    })

    handlers.onCanPlay()

    expect(applyRoomClock).toHaveBeenCalledTimes(1)
    const firstCall = applyRoomClock.mock.calls[0] as unknown as
      [unknown, { paused: boolean }, number] | undefined
    expect(firstCall).toBeDefined()
    const [, syncState, threshold] = firstCall!
    expect(syncState.paused).toBe(true)
    expect(threshold).toBe(0)
    expect(clearTransportNudge).toHaveBeenCalledTimes(1)
    expect(isMediaReadyRef.current).toBe(true)
    expect(setPlaybackUnlocked).toHaveBeenCalledWith(true)
    expect(pendingSyncRef.current).toMatchObject({ paused: false })
  })

  test("onCanPlay unlocks after clock apply (ordering)", () => {
    const order: string[] = []
    const applyRoomClock = mock(() => {
      order.push("clock")
    })
    const player = { volume: 1, muted: false, paused: true }
    const setPlaybackUnlocked = mock((value: boolean) => {
      order.push(`unlock:${String(value)}`)
    })
    const setIsBuffering = mock((value: boolean) => {
      void value
    })
    const setSuppressBufferingUi = mock((value: boolean) => {
      void value
    })
    const isMediaReadyRef = { current: false }
    const handlers = createPlaybackLifecycleHandlers({
      playerRef: { current: player as never },
      current: undefined,
      canControlPlayback: true,
      isMuted: false,
      preferredVolume: 1,
      playbackRef: {
        current: { ...createRoomState().playback, paused: false },
      },
      transportIntentRef: { current: null },
      isMediaReadyRef,
      bufferingSinceRef: { current: null },
      participantStatusErrorRef: { current: null },
      pendingSyncRef: { current: null },
      reportedItemErrorRef: { current: null },
      awaitingSeekTargetMs: null,
      send: (() => {}) as never,
      applyRoomClock: applyRoomClock as never,
      enforceServerPlaybackState: () => {},
      clearTransportNudge: () => {},
      setIsBuffering,
      setPlaybackUnlocked,
      setSuppressBufferingUi,
      setPlaybackError: () => {},
    })

    handlers.onCanPlay()

    expect(order).toEqual(["clock", "unlock:true"])
    expect(isMediaReadyRef.current).toBe(true)
    expect(setSuppressBufferingUi).toHaveBeenCalledWith(true)
  })

  test("onLoadStart locks playback again", () => {
    const { handlers, setPlaybackUnlocked, setIsBuffering, isMediaReadyRef } =
      createDeps({ roomPaused: false })
    handlers.onCanPlay()
    setPlaybackUnlocked.mockClear()
    setIsBuffering.mockClear()

    handlers.onLoadStart()

    expect(isMediaReadyRef.current).toBe(false)
    expect(setPlaybackUnlocked).toHaveBeenCalledWith(false)
    expect(setIsBuffering).toHaveBeenCalledWith(true)
  })

  test("onWaiting during grace does not set buffering", () => {
    const { handlers, setIsBuffering, bufferingSinceRef } = createDeps({
      roomPaused: false,
    })
    handlers.onPlay()
    setIsBuffering.mockClear()
    bufferingSinceRef.current = null

    handlers.onWaiting()

    expect(setIsBuffering).not.toHaveBeenCalled()
    expect(bufferingSinceRef.current).toBeNull()
  })

  test("onWaiting after grace arms buffering", () => {
    const { handlers, setIsBuffering, bufferingSinceRef } = createDeps({
      roomPaused: false,
    })
    handlers.onPlay()
    setIsBuffering.mockClear()

    // Advance past grace by patching Date.now for the waiting check.
    const realNow = Date.now
    Date.now = () => realNow() + PLAYBACK_WAITING_GRACE_MS + 1
    try {
      handlers.onWaiting()
    } finally {
      Date.now = realNow
    }

    expect(setIsBuffering).toHaveBeenCalledWith(true)
    expect(bufferingSinceRef.current).not.toBeNull()
  })
})
