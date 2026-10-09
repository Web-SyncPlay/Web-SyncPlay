import { expect, test } from "bun:test"
import { buildSelectableStreams } from "./build-selectable-streams"

test("prefers adaptive Auto and excludes video-only streams", () => {
  const result = buildSelectableStreams({
    streams: [
      {
        id: "auto",
        src: "https://cdn.example/master.m3u8",
        protocol: "m3u8_native",
        type: "application/x-mpegURL",
        label: "Auto",
        isDefault: true,
      },
      {
        id: "vonly",
        src: "https://cdn.example/video-only.mp4",
        vcodec: "avc1",
        acodec: "none",
        height: 1080,
      },
      {
        id: "720",
        src: "https://cdn.example/720.mp4",
        vcodec: "avc1",
        acodec: "mp4a",
        height: 720,
        label: "720p",
      },
      {
        id: "480",
        src: "https://cdn.example/480.mp4",
        vcodec: "avc1",
        acodec: "mp4a",
        height: 480,
      },
    ],
    textTracks: [],
    playableUrl: "https://cdn.example/master.m3u8",
  })

  expect(result.defaultStreamId).toBe("auto")
  expect(result.mediaStreams.every((stream) => stream.id !== "vonly")).toBe(
    true,
  )
  expect(result.mediaStreams[0]?.kind).toBe("adaptive")
  expect(result.mediaStreams.some((stream) => stream.id === "720")).toBe(true)
})

test("falls back to combined ladder when no adaptive", () => {
  const result = buildSelectableStreams({
    streams: [
      {
        id: "1080",
        src: "https://cdn.example/1080.mp4",
        vcodec: "avc1",
        acodec: "mp4a",
        height: 1080,
      },
      {
        id: "720",
        src: "https://cdn.example/720.mp4",
        vcodec: "avc1",
        acodec: "mp4a",
        height: 720,
      },
    ],
    textTracks: [],
    playableUrl: "https://cdn.example/1080.mp4",
  })

  expect(result.mediaStreams.length >= 1).toBe(true)
  expect(
    result.mediaStreams.every((stream) => stream.kind === "combined"),
  ).toBe(true)
})

test("keeps a single adaptive master and drops HLS variant rungs", () => {
  const result = buildSelectableStreams({
    streams: [
      {
        id: "master",
        src: "https://cdn.example/master.m3u8",
        protocol: "m3u8_native",
        label: "Auto",
        isDefault: true,
      },
      {
        id: "hls-270-0",
        src: "https://cdn.example/270-a.m3u8",
        protocol: "m3u8_native",
        height: 270,
        label: "270p",
      },
      {
        id: "hls-270-1",
        src: "https://cdn.example/270-b.m3u8",
        protocol: "m3u8_native",
        height: 270,
        label: "270p",
      },
      {
        id: "hls-720",
        src: "https://cdn.example/720.m3u8",
        protocol: "m3u8_native",
        height: 720,
        label: "720p",
      },
      {
        id: "720-mp4",
        src: "https://cdn.example/720.mp4",
        vcodec: "avc1",
        acodec: "mp4a",
        height: 720,
        label: "720p",
      },
    ],
    textTracks: [],
    playableUrl: "https://cdn.example/master.m3u8",
  })

  const adaptive = result.mediaStreams.filter((s) => s.kind === "adaptive")
  expect(adaptive).toHaveLength(1)
  expect(adaptive[0]?.src).toBe("https://cdn.example/master.m3u8")
  expect(adaptive[0]?.label).toBe("Auto")
  expect(result.mediaStreams.some((s) => s.id === "720-mp4")).toBe(true)
  expect(result.mediaStreams.some((s) => s.id === "hls-270-0")).toBe(false)
})

test("keeps progressive MP4s with omitted acodec and exposes audio description", () => {
  const result = buildSelectableStreams({
    streams: [
      {
        id: "auto",
        src: "https://cdn.example/master.m3u8",
        protocol: "m3u8_native",
        label: "Auto",
      },
      {
        id: "ad-1080",
        src: "https://cdn.example/show.audio_description.avc-1080.mp4",
        protocol: "https",
        vcodec: "H.264",
        height: 1080,
        label: "HD 1080p",
      },
      {
        id: "main-1080",
        src: "https://cdn.example/show.avc-1080.mp4",
        protocol: "https",
        vcodec: "H.264",
        height: 1080,
        label: "HD 1080p",
      },
      {
        id: "main-720",
        src: "https://cdn.example/show.avc-720.mp4",
        protocol: "https",
        vcodec: "H.264",
        height: 720,
        label: "HD 720p",
      },
      {
        id: "vonly",
        src: "https://cdn.example/video-only.mp4",
        protocol: "https",
        vcodec: "H.264",
        acodec: "none",
        height: 720,
      },
    ],
    textTracks: [],
    playableUrl: "https://cdn.example/master.m3u8",
  })

  expect(result.mediaStreams.some((s) => s.id === "vonly")).toBe(false)
  expect(result.mediaStreams.some((s) => s.label === "Audio Description")).toBe(
    true,
  )
  expect(result.mediaStreams.some((s) => s.id === "main-1080")).toBe(true)
  expect(result.mediaStreams.some((s) => s.id === "main-720")).toBe(true)
  expect(
    result.mediaStreams.filter((s) => s.kind === "adaptive"),
  ).toHaveLength(1)
})
