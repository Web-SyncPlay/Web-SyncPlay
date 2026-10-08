import { describe, expect, test } from "bun:test"
import {
  buildPlayerSrc,
  formatMediaErrorDetail,
  mediaErrorCode,
  normalizeHlsMime,
} from "./player-src"
import type { PlaylistItem, PlaylistMediaStream } from "@/zod/types"

describe("normalizeHlsMime", () => {
  test("normalizes apple and generic mpegurl types", () => {
    expect(normalizeHlsMime("application/vnd.apple.mpegurl")).toBe(
      "application/vnd.apple.mpegurl",
    )
    expect(normalizeHlsMime("application/x-mpegurl")).toBe(
      "application/x-mpegurl",
    )
    expect(normalizeHlsMime("application/vnd.apple.mpegURL")).toBe(
      "application/vnd.apple.mpegurl",
    )
    expect(normalizeHlsMime("video/mp4")).toBeUndefined()
    expect(normalizeHlsMime(undefined)).toBeUndefined()
  })
})

describe("buildPlayerSrc", () => {
  const stream = (partial: Partial<PlaylistMediaStream>): PlaylistMediaStream =>
    ({
      id: "s1",
      src: "https://cdn.example/a.m3u8",
      kind: "adaptive",
      ...partial,
    }) as PlaylistMediaStream

  test("returns empty string for empty src", () => {
    expect(buildPlayerSrc("", undefined, null)).toBe("")
  })

  test("tags HLS from mime or adaptive kind", () => {
    expect(
      buildPlayerSrc("https://cdn.example/a.m3u8", undefined, stream({}), null),
    ).toEqual({
      src: "https://cdn.example/a.m3u8",
      type: "application/x-mpegurl",
    })
    expect(
      buildPlayerSrc(
        "https://cdn.example/a",
        undefined,
        stream({
          kind: "combined",
          type: "application/vnd.apple.mpegurl",
        }),
        null,
      ),
    ).toEqual({
      src: "https://cdn.example/a",
      type: "application/vnd.apple.mpegurl",
    })
  })

  test("tags progressive mime for blob/local URLs", () => {
    expect(
      buildPlayerSrc(
        "blob:https://app/1",
        undefined,
        stream({ kind: "combined", type: "video/mp4" }),
        "video/mp4",
      ),
    ).toEqual({ src: "blob:https://app/1", type: "video/mp4" })
  })

  test("falls back to bare URL when mime is unknown", () => {
    const item = {
      mediaStreams: [{ id: "s1", src: "https://x", type: "application/octet-stream" }],
    } as PlaylistItem
    expect(
      buildPlayerSrc("https://cdn.example/video", item, null, null),
    ).toBe("https://cdn.example/video")
  })

  test("does not force video/mp4 for progressive m2ts URLs", () => {
    const m2ts =
      "https://jf.example/Videos/id/stream?api_key=k&container=m2ts"
    expect(
      buildPlayerSrc(
        m2ts,
        undefined,
        stream({ kind: "combined", type: "video/mp4", src: m2ts }),
        "video/mp4",
      ),
    ).toBe(m2ts)
  })
})

describe("formatMediaErrorDetail / mediaErrorCode", () => {
  test("formats object errors with code and message", () => {
    const detail = { code: 4, message: "Failed to load" } as never
    expect(formatMediaErrorDetail(detail)).toBe("Media error 4: Failed to load")
    expect(mediaErrorCode(detail)).toBe(4)
  })

  test("handles string detail and empty object", () => {
    expect(formatMediaErrorDetail("boom" as never)).toBe("boom")
    expect(formatMediaErrorDetail({} as never)).toBe("Playback error")
    expect(mediaErrorCode(null as never)).toBeNull()
  })
})
