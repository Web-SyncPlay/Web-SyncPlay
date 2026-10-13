import { describe, expect, mock, test } from "bun:test"

import { createVolumeChangeHandler } from "./create-volume-change-handler"
import { markVolumeSettling } from "./use-player-volume"

describe("createVolumeChangeHandler", () => {
  test("does not persist provider volume=1 before media is ready", () => {
    const handleVolumeChange = mock(() => {})
    const player = { volume: 1, muted: false }
    const isMediaReadyRef = { current: false }
    const handlers = createVolumeChangeHandler({
      playerRef: { current: player as never },
      isMuted: false,
      preferredVolume: 0.4,
      unmute: () => 0.4,
      handleVolumeChange,
      isMediaReadyRef,
    })

    handlers.onVolumeChange({ volume: 1, muted: false })

    expect(handleVolumeChange).toHaveBeenCalledWith({
      volume: 1,
      muted: false,
      mediaReady: false,
      volumeSettling: false,
    })
    expect(player.volume).toBe(0.4)
  })

  test("does not persist provider volume=1 during post-canplay settling", () => {
    const handleVolumeChange = mock(() => {})
    const player = { volume: 1, muted: false }
    const isMediaReadyRef = { current: true }
    markVolumeSettling(isMediaReadyRef)
    const handlers = createVolumeChangeHandler({
      playerRef: { current: player as never },
      isMuted: false,
      preferredVolume: 0.4,
      unmute: () => 0.4,
      handleVolumeChange,
      isMediaReadyRef,
    })

    handlers.onVolumeChange({ volume: 1, muted: false })

    expect(handleVolumeChange).toHaveBeenCalledWith({
      volume: 1,
      muted: false,
      mediaReady: true,
      volumeSettling: true,
    })
    expect(player.volume).toBe(0.4)
  })

  test("forwards intentional 100% once media is ready and settled", () => {
    const handleVolumeChange = mock(() => {})
    const player = { volume: 0.4, muted: false }
    const handlers = createVolumeChangeHandler({
      playerRef: { current: player as never },
      isMuted: false,
      preferredVolume: 0.4,
      unmute: () => 0.4,
      handleVolumeChange,
      isMediaReadyRef: { current: true },
    })

    handlers.onVolumeChange({ volume: 1, muted: false })

    expect(handleVolumeChange).toHaveBeenCalledWith({
      volume: 1,
      muted: false,
      mediaReady: true,
      volumeSettling: false,
    })
    // Preference persistence is owned by handleVolumeChange; element stays
    // until React reapplies volume={preferredVolume}.
    expect(player.volume).toBe(0.4)
  })

  test("restores preferred volume on native unmute", () => {
    const handleVolumeChange = mock(() => {})
    const unmute = mock(() => 0.35)
    const player = { volume: 1, muted: true }
    const handlers = createVolumeChangeHandler({
      playerRef: { current: player as never },
      isMuted: true,
      preferredVolume: 0.35,
      unmute,
      handleVolumeChange,
      isMediaReadyRef: { current: true },
    })

    handlers.onVolumeChange({ volume: 1, muted: false })

    expect(unmute).toHaveBeenCalledTimes(1)
    expect(player.volume).toBe(0.35)
    expect(player.muted).toBe(false)
    expect(handleVolumeChange).not.toHaveBeenCalled()
  })
})
