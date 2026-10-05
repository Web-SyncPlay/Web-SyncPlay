import assert from "node:assert/strict"
import test from "node:test"
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

  assert.equal(result.defaultStreamId, "auto")
  assert.ok(result.mediaStreams.every((stream) => stream.id !== "vonly"))
  assert.equal(result.mediaStreams[0]?.kind, "adaptive")
  assert.ok(result.mediaStreams.some((stream) => stream.id === "720"))
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

  assert.ok(result.mediaStreams.length >= 1)
  assert.ok(result.mediaStreams.every((stream) => stream.kind === "combined"))
})
