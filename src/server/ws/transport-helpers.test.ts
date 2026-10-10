import { describe, expect, test } from "bun:test"
import {
  isWsApiUpgradeUrl,
  shouldTerminateForMissedHeartbeat,
} from "./transport-helpers"

describe("isWsApiUpgradeUrl", () => {
  test("matches /api/ws and query variants", () => {
    expect(isWsApiUpgradeUrl("/api/ws")).toBe(true)
    expect(isWsApiUpgradeUrl("/api/ws?room=1")).toBe(true)
    expect(isWsApiUpgradeUrl("/api/ws/")).toBe(true)
  })

  test("rejects unrelated upgrade paths", () => {
    expect(isWsApiUpgradeUrl(undefined)).toBe(false)
    expect(isWsApiUpgradeUrl("/api/health")).toBe(false)
    expect(isWsApiUpgradeUrl("/_next/webpack-hmr")).toBe(false)
    expect(isWsApiUpgradeUrl("/api/wss")).toBe(false)
  })
})

describe("shouldTerminateForMissedHeartbeat", () => {
  test("keeps sockets with recent pongs", () => {
    expect(
      shouldTerminateForMissedHeartbeat({
        nowMs: 10_000,
        lastPongAtMs: 9_000,
        heartbeatTimeoutMs: 3_000,
      }),
    ).toBe(false)
  })

  test("terminates when pong is older than timeout", () => {
    expect(
      shouldTerminateForMissedHeartbeat({
        nowMs: 10_000,
        lastPongAtMs: 6_000,
        heartbeatTimeoutMs: 3_000,
      }),
    ).toBe(true)
  })

  test("treats missing lastPong as just seen", () => {
    expect(
      shouldTerminateForMissedHeartbeat({
        nowMs: 10_000,
        lastPongAtMs: undefined,
        heartbeatTimeoutMs: 3_000,
      }),
    ).toBe(false)
  })
})
