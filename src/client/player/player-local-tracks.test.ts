import { describe, expect, test } from "bun:test"

import {
  audioTrackLabel,
  audioTrackOptionId,
  audioTrackStorageValue,
  findStoredAudioTrackIndex,
  findStoredVideoQualityIndex,
  snapshotAudioTracks,
  snapshotVideoQualities,
  trackStorageKey,
  videoQualityLabel,
  videoQualityStorageValue,
} from "./player-local-tracks"

describe("trackStorageKey", () => {
  test("returns null without an item id", () => {
    expect(trackStorageKey(undefined, "audio")).toBeNull()
    expect(trackStorageKey("", "video")).toBeNull()
  })

  test("scopes keys per item and kind", () => {
    expect(trackStorageKey("item-1", "audio")).toBe(
      "web-syncplay:local-audio-track:item-1",
    )
    expect(trackStorageKey("item-1", "video")).toBe(
      "web-syncplay:local-video-quality:item-1",
    )
  })
})

describe("labels", () => {
  test("prefers track label, then language, then index", () => {
    expect(audioTrackLabel({ label: " English ", language: "en" }, 0)).toBe(
      "English",
    )
    expect(audioTrackLabel({ label: " ", language: "de" }, 1)).toBe("de")
    expect(audioTrackLabel({}, 2)).toBe("Audio 3")
  })

  test("formats video quality with optional bitrate", () => {
    expect(videoQualityLabel({ height: 1080, bitrate: 5_000_000 })).toBe(
      "1080p · 5000 kbps",
    )
    expect(videoQualityLabel({ height: 720, bitrate: null })).toBe("720p")
    expect(videoQualityLabel({ id: "source" })).toBe("source")
  })
})

describe("snapshots", () => {
  test("audio snapshot fills stable fallback ids", () => {
    const options = snapshotAudioTracks([
      { label: "Main", language: "en", selected: true },
      { id: "commentary", label: "Commentary", selected: false },
      { id: "0", label: "BipBop Audio 1", language: "eng", selected: false },
    ])
    expect(audioTrackOptionId({ id: "0", language: "eng" }, 0)).toBe("eng-0")
    expect(options).toEqual([
      {
        id: "en-0",
        label: "Main",
        language: "en",
        selected: true,
        index: 0,
      },
      {
        id: "commentary",
        label: "Commentary",
        language: "",
        selected: false,
        index: 1,
      },
      {
        id: "eng-2",
        label: "BipBop Audio 1",
        language: "eng",
        selected: false,
        index: 2,
      },
    ])
  })

  test("video snapshot stays empty for a single rendition", () => {
    expect(
      snapshotVideoQualities({
        auto: true,
        qualities: [{ id: "only", height: 720, selected: true }],
      }),
    ).toEqual([])
  })

  test("video snapshot prepends Auto and marks selection correctly", () => {
    const options = snapshotVideoQualities({
      auto: false,
      qualities: [
        { id: "q0", height: 1080, bitrate: 4_000_000, selected: false },
        { id: "q1", height: 720, bitrate: 2_000_000, selected: true },
      ],
    })
    expect(options[0]).toEqual({
      id: "auto",
      label: "Auto",
      selected: false,
      index: -1,
    })
    expect(options[2]?.selected).toBe(true)
    expect(options[1]?.selected).toBe(false)
  })

  test("when auto is on, no manual quality appears selected", () => {
    const options = snapshotVideoQualities({
      auto: true,
      qualities: [
        { id: "q0", height: 1080, selected: true },
        { id: "q1", height: 720, selected: false },
      ],
    })
    expect(options[0]?.selected).toBe(true)
    expect(options.slice(1).every((option) => !option.selected)).toBe(true)
  })
})

describe("stored preference matching", () => {
  const tracks = [
    { id: "a0", label: "English", language: "en" },
    { id: "a1", label: "Deutsch", language: "de" },
  ]

  test("matches audio by id, language, or label", () => {
    expect(findStoredAudioTrackIndex(tracks, "a1")).toBe(1)
    expect(findStoredAudioTrackIndex(tracks, "en")).toBe(0)
    expect(findStoredAudioTrackIndex(tracks, "Deutsch")).toBe(1)
    expect(findStoredAudioTrackIndex(tracks, null)).toBe(-1)
    expect(findStoredAudioTrackIndex(tracks, "missing")).toBe(-1)
  })

  test("matches video auto and quality ids/labels", () => {
    const qualities = [
      { id: "q0", height: 1080, bitrate: 4_000_000 },
      { id: "q1", height: 720, bitrate: null },
    ]
    expect(findStoredVideoQualityIndex(qualities, "auto")).toBe("auto")
    expect(findStoredVideoQualityIndex(qualities, "q1")).toBe(1)
    expect(findStoredVideoQualityIndex(qualities, "1080p · 4000 kbps")).toBe(0)
    expect(findStoredVideoQualityIndex(qualities, "nope")).toBe(-1)
  })

  test("storage values prefer stable ids", () => {
    expect(audioTrackStorageValue(tracks[1]!, 1)).toBe("a1")
    expect(
      audioTrackStorageValue({ label: "Narration", language: "" }, 3),
    ).toBe("Narration")
    expect(
      videoQualityStorageValue({ id: "q0", height: 1080 }, false),
    ).toBe("q0")
    expect(videoQualityStorageValue({ height: 720 }, true)).toBe("auto")
  })
})
