import { expect, test } from "bun:test"
import { parseCachedExtract } from "@/server/media/yt-dlp/cache"
import type {
  YtDlpExtractFailure,
  YtDlpExtractSuccess,
} from "@/server/media/yt-dlp/types"

const success = (): YtDlpExtractSuccess => ({
  ok: true,
  title: "Cached",
  durationSeconds: 10,
  isLive: false,
  streams: [
    {
      id: "default",
      src: "https://cdn.example/a.mp4",
      isDefault: true,
    },
  ],
  textTracks: [],
  videoVariants: [],
  audioVariants: [],
  bestPlayableUrl: "https://cdn.example/a.mp4",
  stderr: "",
})

test("accepts versioned envelope within stream URL max age", () => {
  const raw = JSON.stringify({
    v: 1,
    extractedAt: Date.now(),
    result: success(),
  })
  const parsed = parseCachedExtract(raw)
  expect(parsed?.ok).toBe(true)
  if (parsed?.ok) {
    expect(parsed.title).toBe("Cached")
  }
})

test("rejects success envelope older than derived stream URL max age", () => {
  const raw = JSON.stringify({
    v: 1,
    extractedAt: Date.now() - 3_600_000,
    result: success(),
  })
  // Derived max age from default cache TTL (1800) is 600s; 1h-old URLs must miss.
  expect(parseCachedExtract(raw)).toBeNull()
})

test("keeps failure envelopes regardless of age", () => {
  const failure: YtDlpExtractFailure = {
    ok: false,
    title: null,
    durationSeconds: null,
    isLive: null,
    streams: [],
    textTracks: [],
    videoVariants: [],
    audioVariants: [],
    bestPlayableUrl: null,
    stderr: "offline",
    code: 1,
    classification: "not_live",
    userMessage: "not live",
  }
  const raw = JSON.stringify({
    v: 1,
    extractedAt: 0,
    result: failure,
  })
  expect(parseCachedExtract(raw)?.ok).toBe(false)
})

test("rejects corrupt cache payloads", () => {
  expect(parseCachedExtract("{not-json")).toBeNull()
  expect(parseCachedExtract(JSON.stringify({ v: 1, extractedAt: 1 }))).toBeNull()
})

test("rejects legacy bare extract results without envelope", () => {
  expect(parseCachedExtract(JSON.stringify(success()))).toBeNull()
})
