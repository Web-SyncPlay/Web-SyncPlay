import { expect, test } from "bun:test"
import { shouldDeferPlaybackSrc } from "./use-player-media-source"

test("defers playback while resolving or after ingest error", () => {
  expect(shouldDeferPlaybackSrc("resolving")).toBe(true)
  expect(shouldDeferPlaybackSrc("error")).toBe(true)
  expect(shouldDeferPlaybackSrc("ready")).toBe(false)
  expect(shouldDeferPlaybackSrc(undefined)).toBe(false)
})
