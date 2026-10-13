import {
  APP_NODE_ALIVE_TTL_SECONDS,
  APP_NODE_HEARTBEAT_INTERVAL_MS,
  derivedHeartbeatTtlSeconds,
  TOUCH_WS_PRESENCE_MIN_INTERVAL_MS,
} from "@/server/redis/ttl-policy"
import {
  EMPTY_ROOM_DESTROY_GRACE_MS,
  roomActionLogMaxAgeMs,
  roomStateTtlSeconds,
} from "@/shared/room-lifecycle"
import { describe, expect, test } from "bun:test"

describe("redis ttl-policy", () => {
  test("node alive TTL is 3× heartbeat interval", () => {
    expect(APP_NODE_ALIVE_TTL_SECONDS).toBe(
      derivedHeartbeatTtlSeconds(APP_NODE_HEARTBEAT_INTERVAL_MS),
    )
    expect(APP_NODE_ALIVE_TTL_SECONDS).toBe(45)
  })

  test("touch throttle matches node alive TTL", () => {
    expect(TOUCH_WS_PRESENCE_MIN_INTERVAL_MS).toBe(
      APP_NODE_ALIVE_TTL_SECONDS * 1000,
    )
  })

  test("local-media style TTL equals room lifecycle", () => {
    expect(roomStateTtlSeconds).toBe(3600)
    expect(roomActionLogMaxAgeMs).toBe(roomStateTtlSeconds * 1000)
  })

  test("empty-room destroy grace is under participant prune window", () => {
    expect(EMPTY_ROOM_DESTROY_GRACE_MS).toBe(15_000)
    expect(EMPTY_ROOM_DESTROY_GRACE_MS).toBeLessThan(60_000)
  })

  test("derivedHeartbeatTtlSeconds rounds up", () => {
    expect(derivedHeartbeatTtlSeconds(30_000)).toBe(90)
    expect(derivedHeartbeatTtlSeconds(1000)).toBe(3)
  })
})
