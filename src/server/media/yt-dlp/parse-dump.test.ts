import { expect, test } from "bun:test"
import { parseYtDlpDumpJson } from "@/server/media/yt-dlp/parse-dump"

test("parses manifest Auto stream and combined formats", () => {
  const result = parseYtDlpDumpJson(
    JSON.stringify({
      title: "Demo Stream",
      duration: 125.4,
      is_live: false,
      manifest_url: "https://cdn.example/master.m3u8",
      protocol: "m3u8_native",
      formats: [
        {
          format_id: "720",
          url: "https://cdn.example/720.mp4",
          width: 1280,
          height: 720,
          vcodec: "avc1",
          acodec: "mp4a",
          tbr: 2500,
          format_note: "720p",
        },
        {
          format_id: "vonly",
          url: "https://cdn.example/video-only.mp4",
          width: 1920,
          height: 1080,
          vcodec: "avc1",
          acodec: "none",
        },
      ],
      subtitles: {
        en: [{ url: "https://cdn.example/en.vtt", ext: "vtt", name: "English" }],
      },
    }),
  )

  expect(result.ok).toBe(true)
  expect(result.title).toBe("Demo Stream")
  expect(result.durationSeconds).toBe(125)
  expect(result.bestPlayableUrl).toBe("https://cdn.example/master.m3u8")
  expect(result.streams[0]?.id).toBe("auto")
  expect(result.streams.some((s) => s.id === "720")).toBe(true)
  expect(result.videoVariants.some((v) => v.kind === "video")).toBe(true)
  expect(result.textTracks[0]?.language).toBe("en")
  expect(result.textTracks[0]?.isDefault).toBe(true)
})

test("uses top-level url when no manifest", () => {
  const result = parseYtDlpDumpJson(
    JSON.stringify({
      title: "Clip",
      url: "https://cdn.example/clip.mp4",
      ext: "mp4",
      formats: [],
    }),
  )
  expect(result.bestPlayableUrl).toBe("https://cdn.example/clip.mp4")
  expect(result.streams[0]?.id).toBe("default")
})

test("marks upcoming live_status as live", () => {
  const result = parseYtDlpDumpJson(
    JSON.stringify({
      title: "Soon",
      live_status: "is_upcoming",
      url: "https://cdn.example/live.m3u8",
    }),
  )
  expect(result.isLive).toBe(true)
})
