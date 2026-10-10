import { describe, expect, test } from "bun:test"
import {
  resolveCatalogDurationMs,
  resolveCatalogDurationSeconds,
  resolveEffectiveDurationMs,
} from "./playlist-duration"

describe("resolveCatalogDurationSeconds", () => {
  test("returns finite positive catalog values", () => {
    expect(resolveCatalogDurationSeconds({ durationSeconds: 3721 })).toBe(3721)
  })

  test("returns null for live, missing, or invalid values", () => {
    expect(
      resolveCatalogDurationSeconds({ isLive: true, durationSeconds: 100 }),
    ).toBeNull()
    expect(resolveCatalogDurationSeconds({ durationSeconds: 0 })).toBeNull()
    expect(resolveCatalogDurationSeconds({})).toBeNull()
    expect(resolveCatalogDurationSeconds(undefined)).toBeNull()
  })
})

describe("resolveCatalogDurationMs", () => {
  test("converts seconds to floored milliseconds", () => {
    expect(resolveCatalogDurationMs({ durationSeconds: 12.9 })).toBe(12_900)
    expect(resolveCatalogDurationMs({ durationSeconds: 12 })).toBe(12_000)
  })
})

describe("resolveEffectiveDurationMs", () => {
  test("prefers the larger of media and catalog when both present", () => {
    expect(
      resolveEffectiveDurationMs({
        mediaDurationMs: 10_000,
        catalogDurationMs: 12_000,
      }),
    ).toBe(12_000)
  })

  test("returns null when both unknown", () => {
    expect(resolveEffectiveDurationMs({})).toBeNull()
    expect(
      resolveEffectiveDurationMs({ mediaDurationMs: 0, catalogDurationMs: null }),
    ).toBeNull()
  })
})
