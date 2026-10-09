import { describe, expect, test } from "bun:test"
import type { PlaylistTextTrack } from "@/zod/types"
import {
  applyCaptionPreferenceToTracks,
  matchCatalogTextTrackId,
  resolveCaptionPreferencePublish,
} from "./use-player-caption-preferences"

const catalog: PlaylistTextTrack[] = [
  {
    id: "en",
    src: "https://example.com/en.vtt",
    label: "English",
    language: "en",
  },
  {
    id: "de",
    src: "https://example.com/de.vtt",
    label: "Deutsch",
    language: "de",
  },
]

describe("matchCatalogTextTrackId", () => {
  test("matches by id, src, then label/language", () => {
    expect(matchCatalogTextTrackId(catalog, { id: "de" })).toBe("de")
    expect(
      matchCatalogTextTrackId(catalog, {
        src: "https://example.com/en.vtt",
      }),
    ).toBe("en")
    expect(
      matchCatalogTextTrackId(catalog, {
        label: "Deutsch",
        language: "de",
      }),
    ).toBe("de")
    expect(
      matchCatalogTextTrackId(catalog, {
        id: "hls-native",
        label: "Unknown",
      }),
    ).toBeNull()
  })
})

describe("resolveCaptionPreferencePublish", () => {
  test("skips while suppressPublish is set", () => {
    expect(
      resolveCaptionPreferencePublish({
        catalog,
        showing: { id: "en", mode: "showing" },
        currentPrefId: undefined,
        suppressPublish: true,
      }),
    ).toBeUndefined()
  })

  test("publishes catalog match and off; skips unknown / unchanged", () => {
    expect(
      resolveCaptionPreferencePublish({
        catalog,
        showing: { id: "en", mode: "showing" },
        currentPrefId: undefined,
        suppressPublish: false,
      }),
    ).toBe("en")

    expect(
      resolveCaptionPreferencePublish({
        catalog,
        showing: undefined,
        currentPrefId: "en",
        suppressPublish: false,
      }),
    ).toBeNull()

    expect(
      resolveCaptionPreferencePublish({
        catalog,
        showing: { id: "hls-only", label: "CC", mode: "showing" },
        currentPrefId: undefined,
        suppressPublish: false,
      }),
    ).toBeUndefined()

    expect(
      resolveCaptionPreferencePublish({
        catalog,
        showing: { id: "en", mode: "showing" },
        currentPrefId: "en",
        suppressPublish: false,
      }),
    ).toBeUndefined()
  })
})

describe("applyCaptionPreferenceToTracks", () => {
  test("shows preferred track and disables siblings", () => {
    const tracks = [
      { id: "en", mode: "disabled" },
      { id: "de", mode: "showing" },
    ]
    expect(applyCaptionPreferenceToTracks(tracks, catalog, "en")).toBe(true)
    expect(tracks.map((t) => t.mode)).toEqual(["showing", "disabled"])
  })

  test("turns captions off when preferredId is null", () => {
    const tracks = [
      { id: "en", mode: "showing" },
      { id: "de", mode: "disabled" },
    ]
    expect(applyCaptionPreferenceToTracks(tracks, catalog, null)).toBe(true)
    expect(tracks.every((t) => t.mode === "disabled")).toBe(true)
  })

  test("skips when preferredId is unset", () => {
    const tracks = [{ id: "en", mode: "showing" }]
    expect(
      applyCaptionPreferenceToTracks(tracks, catalog, undefined),
    ).toBe(false)
    expect(tracks[0]?.mode).toBe("showing")
  })
})
