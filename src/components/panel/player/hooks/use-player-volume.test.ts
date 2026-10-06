import { describe, expect, test } from "bun:test"

import {
  DEFAULT_PLAYER_VOLUME,
  resolveUnmuteVolume,
} from "./use-player-volume"

describe("resolveUnmuteVolume", () => {
  test("keeps a stored preference above silence", () => {
    expect(resolveUnmuteVolume(0.4)).toBe(0.4)
    expect(resolveUnmuteVolume(0.75)).toBe(0.75)
    expect(resolveUnmuteVolume(1)).toBe(1)
  })

  test("falls back to 40% when preferred volume is silent", () => {
    expect(resolveUnmuteVolume(0)).toBe(DEFAULT_PLAYER_VOLUME)
    expect(resolveUnmuteVolume(0.01)).toBe(DEFAULT_PLAYER_VOLUME)
    expect(resolveUnmuteVolume(0.005)).toBe(DEFAULT_PLAYER_VOLUME)
  })
})
