import { expect, test } from "bun:test"
import fc from "fast-check"
import {
  collectM3u8ReferencedUrls,
  playlistTargetHint,
  rewriteM3u8BodyWithProxyMap,
  shouldAttemptPlaylistRewrite,
} from "@/server/media/hls-proxy-rewrite"
import { sha256HexUrl, sha256HexUrlPrefix } from "@/server/media/url-hash"

const baseUrl = "https://cdn.example.com/live/master.m3u8"

const relativeSegment = fc.stringMatching(/^[a-z0-9][a-z0-9._/-]{0,40}\.ts$/)

const absoluteHttpUrl = fc
  .tuple(
    fc.constantFrom("http", "https"),
    fc.stringMatching(/^[a-z]{2,8}\.[a-z]{2,6}$/),
    fc.stringMatching(/^\/[a-z0-9][a-z0-9/_-]{0,40}\.(ts|m3u8)$/),
  )
  .map(([scheme, host, path]) => `${scheme}://${host}${path}`)

test("collectM3u8ReferencedUrls never throws and only yields http(s) absolutes", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 400 }), (body) => {
      const urls = collectM3u8ReferencedUrls(body, baseUrl)
      for (const url of urls) {
        expect(/^https?:\/\//i.test(url)).toBe(true)
        expect(() => new URL(url)).not.toThrow()
      }
    }),
    { numRuns: 100 },
  )
})

test("segment lines and URI= attributes are collected as absolute URLs", () => {
  fc.assert(
    fc.property(absoluteHttpUrl, relativeSegment, (abs, rel) => {
      const body = [
        "#EXTM3U",
        `#EXT-X-KEY:METHOD=AES-128,URI="${abs}"`,
        `#EXT-X-MAP:URI='${rel}'`,
        abs,
        rel,
      ].join("\n")

      const urls = collectM3u8ReferencedUrls(body, baseUrl)
      expect(urls.has(abs)).toBe(true)
      expect(urls.has(new URL(rel, baseUrl).href)).toBe(true)
    }),
    { numRuns: 60 },
  )
})

test("empty proxy map is a line-ending-normalized identity rewrite", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 300 }), (body) => {
      const normalized = body.split(/\r?\n/).join("\n")
      const rewritten = rewriteM3u8BodyWithProxyMap(
        body,
        baseUrl,
        new Map(),
      )
      expect(rewritten).toBe(normalized)
    }),
    { numRuns: 80 },
  )
})

test("mapped absolute URLs are substituted in URI attrs and segment lines", () => {
  fc.assert(
    fc.property(absoluteHttpUrl, (abs) => {
      const proxy = `/api/media/proxy/token-${abs.length}`
      const body = [
        "#EXTM3U",
        `#EXT-X-KEY:METHOD=AES-128,URI="${abs}"`,
        abs,
      ].join("\n")

      const rewritten = rewriteM3u8BodyWithProxyMap(
        body,
        baseUrl,
        new Map([[abs, proxy]]),
      )

      expect(rewritten).toContain(`URI="${proxy}"`)
      expect(rewritten.split("\n").at(-1)).toBe(proxy)
      expect(rewritten).not.toContain(abs)
    }),
    { numRuns: 50 },
  )
})

test("shouldAttemptPlaylistRewrite detects content-type or #EXTM3U", () => {
  fc.assert(
    fc.property(
      fc.string({ maxLength: 80 }),
      fc.string({ maxLength: 120 }),
      (noiseCt, noiseBody) => {
        expect(
          shouldAttemptPlaylistRewrite("application/vnd.apple.mpegurl", noiseBody),
        ).toBe(true)
        expect(shouldAttemptPlaylistRewrite("audio/m3u8", noiseBody)).toBe(true)
        expect(
          shouldAttemptPlaylistRewrite(noiseCt, `#EXTM3U\n${noiseBody}`),
        ).toBe(true)
      },
    ),
    { numRuns: 40 },
  )
})

test("playlistTargetHint treats mpegurl and opaque cdn types as playlists", () => {
  expect(
    playlistTargetHint("https://cdn.example/x", "application/vnd.apple.mpegurl"),
  ).toBe(true)
  expect(playlistTargetHint("https://cdn.example/live.m3u8", "")).toBe(true)
  expect(
    playlistTargetHint("https://cdn.example/seg", "application/octet-stream"),
  ).toBe(true)
  expect(
    playlistTargetHint("https://cdn.example/seg.ts", "application/octet-stream"),
  ).toBe(false)
})

test("sha256HexUrl is stable and prefix matches", () => {
  const url = "https://cdn.example/a.mp4"
  expect(sha256HexUrl(url)).toHaveLength(64)
  expect(sha256HexUrlPrefix(url, 16)).toBe(sha256HexUrl(url).slice(0, 16))
  expect(sha256HexUrl(url)).toBe(sha256HexUrl(url))
})
