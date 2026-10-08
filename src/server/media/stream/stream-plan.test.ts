import { describe, expect, test } from "bun:test"
import { hostRequiresMediaRelay } from "@/server/media/stream/requires-relay"
import { buildStreamPlan } from "@/server/media/stream/stream-plan"

describe("hostRequiresMediaRelay", () => {
  test("matches SoundCloud page and CDN hosts", () => {
    expect(hostRequiresMediaRelay("https://soundcloud.com/forss/flickermood")).toBe(
      true,
    )
    expect(
      hostRequiresMediaRelay(
        "https://cf-hls-media.sndcdn.com/playlist/x.m3u8",
      ),
    ).toBe(true)
    expect(
      hostRequiresMediaRelay(
        "https://playback.media-streaming.soundcloud.cloud/x/playlist.m3u8",
      ),
    ).toBe(true)
  })

  test("ignores unrelated hosts", () => {
    expect(hostRequiresMediaRelay("https://www.twitch.tv/eslcs")).toBe(false)
    expect(
      hostRequiresMediaRelay("https://www.soundhelix.com/examples/mp3/a.mp3"),
    ).toBe(false)
  })

  test("forces relay for loopback and private LAN hosts", () => {
    expect(
      hostRequiresMediaRelay("http://127.0.0.1:8096/Videos/x/main.m3u8"),
    ).toBe(true)
    expect(hostRequiresMediaRelay("http://localhost:8096/a.m3u8")).toBe(true)
    expect(
      hostRequiresMediaRelay("http://192.168.1.10:8096/Videos/x/main.m3u8"),
    ).toBe(true)
  })
})

describe("buildStreamPlan", () => {
  test("forces relay for SoundCloud even when CORS probe passes", () => {
    expect(
      buildStreamPlan({
        playableUrl:
          "https://playback.media-streaming.soundcloud.cloud/x/playlist.m3u8",
        sourceUrl: "https://soundcloud.com/forss/flickermood",
        isNativeProvider: false,
        corsAllowed: true,
      }).playbackMode,
    ).toBe("relay")
  })

  test("keeps direct when CORS allows and host is not forced", () => {
    expect(
      buildStreamPlan({
        playableUrl: "https://upload.wikimedia.org/media.mp3",
        isNativeProvider: false,
        corsAllowed: true,
      }).playbackMode,
    ).toBe("direct")
  })

  test("uses relay when CORS blocks", () => {
    expect(
      buildStreamPlan({
        playableUrl: "https://cdn.example.com/v.m3u8",
        isNativeProvider: false,
        corsAllowed: false,
      }).playbackMode,
    ).toBe("relay")
  })

  test("forces relay for LAN Jellyfin even when CORS probe passes", () => {
    expect(
      buildStreamPlan({
        playableUrl: "http://127.0.0.1:8096/Videos/x/main.m3u8?api_key=k",
        isNativeProvider: false,
        corsAllowed: true,
      }).playbackMode,
    ).toBe("relay")
  })
})
