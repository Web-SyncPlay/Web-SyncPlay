import { expect, test } from "bun:test"

import {
  shouldDeferLocalMediaRelaySrc,
  shouldDeferPlaybackSrc,
} from "./use-player-media-source"

test("defers playback while resolving or after ingest error", () => {
  expect(shouldDeferPlaybackSrc("resolving")).toBe(true)
  expect(shouldDeferPlaybackSrc("error")).toBe(true)
  expect(shouldDeferPlaybackSrc("ready")).toBe(false)
  expect(shouldDeferPlaybackSrc(undefined)).toBe(false)
})

test("defers public local-media relay until viewer token exists", () => {
  expect(shouldDeferLocalMediaRelaySrc("/api/media/local/abc", false)).toBe(
    true,
  )
  expect(shouldDeferLocalMediaRelaySrc("/api/media/local/abc?x=1", true)).toBe(
    false,
  )
  expect(shouldDeferLocalMediaRelaySrc("blob:http://x/1", false)).toBe(false)
  expect(
    shouldDeferLocalMediaRelaySrc("/api/media/local/internal/abc", false),
  ).toBe(false)
  expect(
    shouldDeferLocalMediaRelaySrc("https://cdn.example/a.mp4", false),
  ).toBe(false)
})
