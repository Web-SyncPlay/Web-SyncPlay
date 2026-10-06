import { expect, test } from "bun:test"
import {
  derivedExtractFailoverWaitMs,
  derivedLockHeartbeatTtlSeconds,
  derivedResolveReclaimIntervalMs,
  derivedStreamUrlMaxAgeSeconds,
  derivedYtDlpDumpArgs,
  PLAYBACK_MAX_HEIGHT,
} from "@/server/media/yt-dlp/policy"

test("stream URL max age is derived from cache TTL", () => {
  expect(derivedStreamUrlMaxAgeSeconds(0)).toBe(0)
  expect(derivedStreamUrlMaxAgeSeconds(1800)).toBe(600)
  expect(derivedStreamUrlMaxAgeSeconds(300)).toBe(120)
  expect(derivedStreamUrlMaxAgeSeconds(60)).toBe(60)
  expect(derivedStreamUrlMaxAgeSeconds(90)).toBe(90)
})

test("lock heartbeat is short; failover wait covers primary + retry", () => {
  expect(derivedLockHeartbeatTtlSeconds(30_000)).toBe(20)
  expect(derivedExtractFailoverWaitMs(30_000)).toBe(75_000)
  expect(derivedResolveReclaimIntervalMs(30_000)).toBeGreaterThanOrEqual(5_000)
})

test("dump args target playback ladder without format checking", () => {
  const args = derivedYtDlpDumpArgs("https://example.com/watch")
  expect(args).toContain("--no-check-formats")
  expect(args).toContain("--dump-single-json")
  expect(args.some((a) => a.includes(`height<=${PLAYBACK_MAX_HEIGHT}`))).toBe(
    true,
  )
  expect(args.at(-1)).toBe("https://example.com/watch")
})
