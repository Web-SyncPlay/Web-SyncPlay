import { describe, expect, test } from "bun:test"
import {
  UNSUPPORTED_MPEG_TS_PROGRESSIVE_MESSAGE,
  isJellyfinEmbyHlsUrl,
  isUnsupportedMpegTsProgressiveUrl,
  looksLikeJellyfinEmbyPlaybackUrl,
  shapeJellyfinEmbyHlsUrl,
} from "./jellyfin-emby-url"

describe("looksLikeJellyfinEmbyPlaybackUrl / isJellyfinEmbyHlsUrl", () => {
  test("detects Videos HLS paths", () => {
    const url =
      "https://jellyfin.example/Videos/abc123/main.m3u8?api_key=secret"
    expect(looksLikeJellyfinEmbyPlaybackUrl(url)).toBe(true)
    expect(isJellyfinEmbyHlsUrl(url)).toBe(true)
  })

  test("detects master.m3u8", () => {
    expect(
      isJellyfinEmbyHlsUrl(
        "http://emby.local:8096/Videos/id/master.m3u8?MediaSourceId=id",
      ),
    ).toBe(true)
  })

  test("ignores unrelated URLs", () => {
    expect(
      looksLikeJellyfinEmbyPlaybackUrl("https://cdn.example/video.m3u8"),
    ).toBe(false)
    expect(
      isJellyfinEmbyHlsUrl("https://youtube.com/watch?v=abc"),
    ).toBe(false)
  })
})

describe("isUnsupportedMpegTsProgressiveUrl", () => {
  test("flags .ts / .m2ts files", () => {
    expect(
      isUnsupportedMpegTsProgressiveUrl("https://cdn.example/clip.ts"),
    ).toBe(true)
    expect(
      isUnsupportedMpegTsProgressiveUrl("https://cdn.example/clip.m2ts?x=1"),
    ).toBe(true)
  })

  test("flags Jellyfin stream?container=m2ts", () => {
    expect(
      isUnsupportedMpegTsProgressiveUrl(
        "https://jf.example/Videos/id/stream?api_key=k&container=m2ts",
      ),
    ).toBe(true)
  })

  test("does not flag HLS playlists or mp4", () => {
    expect(
      isUnsupportedMpegTsProgressiveUrl(
        "https://jf.example/Videos/id/main.m3u8?api_key=k",
      ),
    ).toBe(false)
    expect(
      isUnsupportedMpegTsProgressiveUrl("https://cdn.example/a.mp4"),
    ).toBe(false)
  })
})

describe("shapeJellyfinEmbyHlsUrl", () => {
  test("forces browser-safe codec params and clears m2ts mode", () => {
    const input =
      "https://jellyfin.example/Videos/abc/main.m3u8?api_key=secret&enableMpegtsM2TsMode=true&VideoCodec=hevc"
    const shaped = shapeJellyfinEmbyHlsUrl(input)
    const url = new URL(shaped)
    expect(url.searchParams.get("api_key")).toBe("secret")
    expect(url.searchParams.get("VideoCodec")).toBe("h264")
    expect(url.searchParams.get("AudioCodec")).toBe("aac")
    expect(url.searchParams.get("EnableAutoStreamCopy")).toBe("false")
    expect(url.searchParams.get("AllowVideoStreamCopy")).toBe("false")
    expect(url.searchParams.get("AllowAudioStreamCopy")).toBe("false")
    expect(url.searchParams.get("enableMpegtsM2TsMode")).toBe("false")
    expect(url.searchParams.get("SegmentContainer")).toBe("ts")
  })

  test("leaves non-Jellyfin URLs unchanged", () => {
    const cdn = "https://cdn.example/show/master.m3u8?token=1"
    expect(shapeJellyfinEmbyHlsUrl(cdn)).toBe(cdn)
  })

  test("message constant is user-facing", () => {
    expect(UNSUPPORTED_MPEG_TS_PROGRESSIVE_MESSAGE).toContain("HLS")
  })
})
