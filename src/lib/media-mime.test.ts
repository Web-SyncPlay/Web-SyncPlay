import { describe, expect, test } from "bun:test"
import {
  guessMimeTypeFromFilename,
  isProgressiveMediaMime,
  resolvePlayableMimeType,
} from "@/lib/media-mime"

describe("media-mime", () => {
  test("guesses common extensions", () => {
    expect(guessMimeTypeFromFilename("clip.MP4")).toBe("video/mp4")
    expect(guessMimeTypeFromFilename("track.mp3")).toBe("audio/mpeg")
    expect(guessMimeTypeFromFilename("noext")).toBeNull()
  })

  test("prefers File.type when playable", () => {
    expect(resolvePlayableMimeType("video/webm", "clip.mp4")).toBe("video/webm")
    expect(resolvePlayableMimeType("", "clip.mp4")).toBe("video/mp4")
    expect(resolvePlayableMimeType("application/octet-stream", "a.webm")).toBe(
      "video/webm",
    )
  })

  test("detects progressive media MIME", () => {
    expect(isProgressiveMediaMime("video/mp4")).toBe(true)
    expect(isProgressiveMediaMime("audio/mpeg")).toBe(true)
    expect(isProgressiveMediaMime("application/x-mpegurl")).toBe(false)
  })
})
