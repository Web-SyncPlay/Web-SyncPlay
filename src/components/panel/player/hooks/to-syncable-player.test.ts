import { describe, expect, test } from "bun:test"
import { toSyncablePlayer } from "./to-syncable-player"

describe("toSyncablePlayer live bounds", () => {
  test("duration and seekableEnd getters reflect mid-session updates", () => {
    let mediaDuration = 5.05
    let seekableEnd = 5.01
    const mediaEl = {
      currentTime: 5,
      duration: mediaDuration,
      paused: true,
      seekable: {
        length: 1,
        end: () => seekableEnd,
      },
      pause() {
        this.paused = true
      },
      play() {},
    }
    Object.defineProperty(mediaEl, "duration", {
      get: () => mediaDuration,
      configurable: true,
    })
    const el = {
      querySelector: (sel: string) =>
        sel.includes("video") || sel.includes("audio") ? mediaEl : null,
    }
    const player = {
      paused: true,
      currentTime: 5,
      duration: 5.05,
      playbackRate: 1,
      el,
      pause() {},
      play() {},
    }

    const syncable = toSyncablePlayer(player as never)
    expect(syncable.duration).toBeCloseTo(5.05, 2)
    expect(syncable.seekableEnd).toBeCloseTo(5.01, 2)

    mediaDuration = 180
    seekableEnd = 45
    player.duration = 180
    expect(syncable.duration).toBeCloseTo(180, 2)
    expect(syncable.seekableEnd).toBeCloseTo(45, 2)
  })
})

describe("toSyncablePlayer transport", () => {
  test("playbackRate setter writes through to the Vidstack instance", () => {
    const player = {
      paused: true,
      currentTime: 0,
      duration: 60,
      playbackRate: 1,
      el: { querySelector: () => null },
      pause() {},
      play() {},
    }
    const syncable = toSyncablePlayer(player as never)
    syncable.playbackRate = 1.15
    expect(player.playbackRate).toBe(1.15)
    player.playbackRate = 1.25
    expect(syncable.playbackRate).toBe(1.25)
  })

  test("paused is false when the media element is still playing", () => {
    const mediaEl = {
      currentTime: 4,
      paused: false,
      pause() {
        this.paused = true
      },
      play() {},
    }
    const el = {
      querySelector: (sel: string) =>
        sel.includes("video") || sel.includes("audio") ? mediaEl : null,
    }
    const player = {
      paused: true,
      currentTime: 4,
      duration: 60,
      playbackRate: 1,
      el,
      pause() {
        this.paused = true
      },
      play() {
        this.paused = false
      },
    }

    const syncable = toSyncablePlayer(player as never)
    expect(syncable.paused).toBe(false)
    syncable.pause()
    expect(mediaEl.paused).toBe(true)
    expect(syncable.paused).toBe(true)
  })

  test("paused trusts mediaEl when wrapper falsely reports playing", () => {
    const mediaEl = {
      currentTime: 4,
      paused: true,
      pause() {},
      play() {
        this.paused = false
      },
    }
    const el = {
      querySelector: (sel: string) =>
        sel.includes("video") || sel.includes("audio") ? mediaEl : null,
    }
    const player = {
      paused: false,
      currentTime: 4,
      duration: 60,
      playbackRate: 1,
      el,
      pause() {
        this.paused = true
      },
      play() {
        this.paused = false
        return undefined
      },
    }

    const syncable = toSyncablePlayer(player as never)
    expect(syncable.paused).toBe(true)
    syncable.play()
    expect(mediaEl.paused).toBe(false)
  })

  test("native mode ignores page media elements", () => {
    const mediaEl = {
      currentTime: 99,
      paused: false,
      pause() {},
      play() {},
    }
    const el = {
      querySelector: () => mediaEl,
    }
    const player = {
      paused: true,
      currentTime: 12,
      duration: 60,
      playbackRate: 1,
      el,
      pause() {},
      play() {},
    }

    const syncable = toSyncablePlayer(player as never, { native: true })
    expect(syncable.mediaEl).toBeNull()
    expect(syncable.paused).toBe(true)
    expect(syncable.currentTime).toBe(12)
  })
})
