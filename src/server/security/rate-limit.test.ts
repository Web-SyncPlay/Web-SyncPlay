import { afterEach, describe, expect, mock, test } from "bun:test"
import type { IncomingMessage } from "node:http"

function upgradeRequest(opts: {
  headers?: Record<string, string | string[] | undefined>
  remoteAddress?: string
}): IncomingMessage {
  return {
    headers: opts.headers ?? {},
    socket: { remoteAddress: opts.remoteAddress },
  } as IncomingMessage
}

describe("clientIpFromForwardingHeaders", () => {
  test("uses first X-Forwarded-For hop over X-Real-IP", async () => {
    const { clientIpFromForwardingHeaders } = await import("./rate-limit")
    expect(
      clientIpFromForwardingHeaders({
        forwardedFor: "203.0.113.10, 10.0.0.1",
        realIp: "10.0.0.2",
      }),
    ).toBe("203.0.113.10")
  })

  test("accepts array header values like IncomingMessage", async () => {
    const { clientIpFromForwardingHeaders } = await import("./rate-limit")
    expect(
      clientIpFromForwardingHeaders({
        forwardedFor: ["203.0.113.20, 10.0.0.1"],
        realIp: ["198.51.100.1"],
      }),
    ).toBe("203.0.113.20")
  })
})

describe("clientIpFromRequest", () => {
  test("uses first X-Forwarded-For hop", async () => {
    const { clientIpFromRequest } = await import("./rate-limit")
    const request = new Request("https://example.test/", {
      headers: {
        "x-forwarded-for": "203.0.113.10, 10.0.0.1",
        "x-real-ip": "10.0.0.2",
      },
    })
    expect(clientIpFromRequest(request)).toBe("203.0.113.10")
  })

  test("falls back to X-Real-IP then unknown", async () => {
    const { clientIpFromRequest } = await import("./rate-limit")
    expect(
      clientIpFromRequest(
        new Request("https://example.test/", {
          headers: { "x-real-ip": "198.51.100.1" },
        }),
      ),
    ).toBe("198.51.100.1")
    expect(clientIpFromRequest(new Request("https://example.test/"))).toBe(
      "unknown",
    )
  })
})

describe("clientIpFromUpgradeRequest", () => {
  test("uses first X-Forwarded-For hop over socket", async () => {
    const { clientIpFromUpgradeRequest } = await import("./rate-limit")
    expect(
      clientIpFromUpgradeRequest(
        upgradeRequest({
          headers: {
            "x-forwarded-for": "203.0.113.10, 10.0.0.1",
            "x-real-ip": "10.0.0.2",
          },
          remoteAddress: "127.0.0.1",
        }),
      ),
    ).toBe("203.0.113.10")
  })

  test("falls back to X-Real-IP then socket.remoteAddress", async () => {
    const { clientIpFromUpgradeRequest } = await import("./rate-limit")
    expect(
      clientIpFromUpgradeRequest(
        upgradeRequest({
          headers: { "x-real-ip": "198.51.100.1" },
          remoteAddress: "127.0.0.1",
        }),
      ),
    ).toBe("198.51.100.1")
    expect(
      clientIpFromUpgradeRequest(
        upgradeRequest({ remoteAddress: "192.0.2.55" }),
      ),
    ).toBe("192.0.2.55")
    expect(clientIpFromUpgradeRequest(upgradeRequest({}))).toBe("unknown")
  })
})

describe("client IP path parity", () => {
  test("Request and upgrade agree when X-Forwarded-For is present", async () => {
    const { clientIpFromRequest, clientIpFromUpgradeRequest } =
      await import("./rate-limit")
    const xff = "203.0.113.10, 10.0.0.1"
    const request = new Request("https://example.test/", {
      headers: { "x-forwarded-for": xff, "x-real-ip": "10.0.0.2" },
    })
    const upgrade = upgradeRequest({
      headers: { "x-forwarded-for": xff, "x-real-ip": "10.0.0.2" },
      remoteAddress: "127.0.0.1",
    })
    expect(clientIpFromRequest(request)).toBe("203.0.113.10")
    expect(clientIpFromUpgradeRequest(upgrade)).toBe(
      clientIpFromRequest(request),
    )
  })

  test("Request and upgrade agree when only X-Real-IP is present", async () => {
    const { clientIpFromRequest, clientIpFromUpgradeRequest } =
      await import("./rate-limit")
    const realIp = "198.51.100.1"
    const request = new Request("https://example.test/", {
      headers: { "x-real-ip": realIp },
    })
    const upgrade = upgradeRequest({
      headers: { "x-real-ip": realIp },
      remoteAddress: "127.0.0.1",
    })
    expect(clientIpFromUpgradeRequest(upgrade)).toBe(
      clientIpFromRequest(request),
    )
  })
})

function createIncrMock(opts?: {
  fail?: boolean
  counts?: Map<string, number>
}) {
  const counts = opts?.counts ?? new Map<string, number>()
  return {
    incr: async (key: string) => {
      if (opts?.fail) throw new Error("redis down")
      const next = (counts.get(key) ?? 0) + 1
      counts.set(key, next)
      return next
    },
    expire: async () => true,
  }
}

/** In-memory stand-in for the Redis Lua token-bucket script. */
function createTokenBucketEvalMock(opts?: {
  fail?: boolean
  buckets?: Map<string, { tokens: number; updatedAtMs: number }>
}) {
  const buckets =
    opts?.buckets ?? new Map<string, { tokens: number; updatedAtMs: number }>()
  return {
    incr: async () => 1,
    expire: async () => true,
    eval: async (
      _script: string,
      params: { keys: string[]; arguments: string[] },
    ) => {
      if (opts?.fail) throw new Error("redis down")
      const key = params.keys[0]!
      const capacity = Number(params.arguments[0])
      const refillPerSecond = Number(params.arguments[1])
      const nowMs = Number(params.arguments[2])
      const cost = Number(params.arguments[3])

      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = { tokens: capacity, updatedAtMs: nowMs }
        buckets.set(key, bucket)
      } else {
        const elapsedSec = Math.max(0, (nowMs - bucket.updatedAtMs) / 1000)
        bucket.tokens = Math.min(
          capacity,
          bucket.tokens + elapsedSec * refillPerSecond,
        )
        bucket.updatedAtMs = nowMs
      }

      if (bucket.tokens < cost) {
        return [0, Math.floor(bucket.tokens)]
      }
      bucket.tokens -= cost
      return [1, Math.floor(bucket.tokens)]
    },
  }
}

afterEach(async () => {
  mock.restore()
  const { resetTokenBucketsForTests } = await import("./rate-limit")
  resetTokenBucketsForTests()
})

describe("consumeTokenBucket", () => {
  test("allows under capacity and denies when empty", async () => {
    const { consumeTokenBucket } = await import("./rate-limit")
    const key = "tb:a"
    expect(
      consumeTokenBucket({
        key,
        capacity: 2,
        refillPerSecond: 0,
        nowMs: 1_000,
      }),
    ).toEqual({ allowed: true, remaining: 1 })
    expect(
      consumeTokenBucket({
        key,
        capacity: 2,
        refillPerSecond: 0,
        nowMs: 1_000,
      }),
    ).toEqual({ allowed: true, remaining: 0 })
    expect(
      consumeTokenBucket({
        key,
        capacity: 2,
        refillPerSecond: 0,
        nowMs: 1_000,
      }),
    ).toEqual({ allowed: false, remaining: 0 })
  })

  test("refills over time up to capacity", async () => {
    const { consumeTokenBucket } = await import("./rate-limit")
    const key = "tb:refill"
    expect(
      consumeTokenBucket({
        key,
        capacity: 2,
        refillPerSecond: 10,
        nowMs: 0,
      }).allowed,
    ).toBe(true)
    expect(
      consumeTokenBucket({
        key,
        capacity: 2,
        refillPerSecond: 10,
        nowMs: 0,
      }).allowed,
    ).toBe(true)
    expect(
      consumeTokenBucket({
        key,
        capacity: 2,
        refillPerSecond: 10,
        nowMs: 0,
      }).allowed,
    ).toBe(false)

    // 0.2s * 10/s = 2 tokens restored
    expect(
      consumeTokenBucket({
        key,
        capacity: 2,
        refillPerSecond: 10,
        nowMs: 200,
      }),
    ).toEqual({ allowed: true, remaining: 1 })
  })
})

function mockRedisTokenBucketClient(opts?: {
  fail?: boolean
  buckets?: Map<string, { tokens: number; updatedAtMs: number }>
}) {
  const client = createTokenBucketEvalMock(opts)
  mock.module("@/server/redis/client", () => ({
    getCommandClient: async () => client,
  }))
  return client
}

describe("consumeRedisTokenBucket", () => {
  test("allows under capacity and denies when empty", async () => {
    mockRedisTokenBucketClient()

    const { consumeRedisTokenBucket } = await import("./rate-limit")
    const key = "tb:redis:a"
    expect(
      await consumeRedisTokenBucket({
        key,
        capacity: 2,
        refillPerSecond: 0,
        nowMs: 1_000,
      }),
    ).toEqual({ allowed: true, remaining: 1 })
    expect(
      await consumeRedisTokenBucket({
        key,
        capacity: 2,
        refillPerSecond: 0,
        nowMs: 1_000,
      }),
    ).toEqual({ allowed: true, remaining: 0 })
    expect(
      await consumeRedisTokenBucket({
        key,
        capacity: 2,
        refillPerSecond: 0,
        nowMs: 1_000,
      }),
    ).toEqual({ allowed: false, remaining: 0 })
  })

  test("refills over time up to capacity", async () => {
    mockRedisTokenBucketClient()

    const { consumeRedisTokenBucket } = await import("./rate-limit")
    const key = "tb:redis:refill"
    expect(
      (
        await consumeRedisTokenBucket({
          key,
          capacity: 2,
          refillPerSecond: 10,
          nowMs: 0,
        })
      ).allowed,
    ).toBe(true)
    expect(
      (
        await consumeRedisTokenBucket({
          key,
          capacity: 2,
          refillPerSecond: 10,
          nowMs: 0,
        })
      ).allowed,
    ).toBe(true)
    expect(
      (
        await consumeRedisTokenBucket({
          key,
          capacity: 2,
          refillPerSecond: 10,
          nowMs: 0,
        })
      ).allowed,
    ).toBe(false)

    expect(
      await consumeRedisTokenBucket({
        key,
        capacity: 2,
        refillPerSecond: 10,
        nowMs: 200,
      }),
    ).toEqual({ allowed: true, remaining: 1 })
  })

  test("denies by default when Redis is unavailable", async () => {
    mockRedisTokenBucketClient({ fail: true })

    const { consumeRedisTokenBucket } = await import("./rate-limit")
    expect(
      await consumeRedisTokenBucket({
        key: "tb:fail-closed",
        capacity: 10,
        refillPerSecond: 1,
      }),
    ).toEqual({ allowed: false, remaining: 0 })
  })

  test("allows when failOpen is true and Redis is unavailable", async () => {
    mockRedisTokenBucketClient({ fail: true })

    const { consumeRedisTokenBucket } = await import("./rate-limit")
    expect(
      await consumeRedisTokenBucket({
        key: "tb:fail-open",
        capacity: 10,
        refillPerSecond: 1,
        failOpen: true,
      }),
    ).toEqual({ allowed: true, remaining: 10 })
  })
})

describe("consumeHotWsEventLimit", () => {
  test("trips seek:preview after burst for the same room+user", async () => {
    mockRedisTokenBucketClient()

    const {
      HOT_WS_EVENT_LIMITS,
      consumeHotWsEventLimit,
      hotWsEventRateKey,
    } = await import("./rate-limit")
    const roomId = "room-hot"
    const userId = "user-hot"
    const { capacity } = HOT_WS_EVENT_LIMITS["seek:preview"]
    let allowed = 0
    let denied = 0
    for (let i = 0; i < capacity + 5; i++) {
      const result = await consumeHotWsEventLimit({
        type: "seek:preview",
        roomId,
        userId,
        nowMs: 1_000,
      })
      if (result.allowed) allowed += 1
      else denied += 1
    }
    expect(allowed).toBe(capacity)
    expect(denied).toBe(5)
    expect(hotWsEventRateKey("seek:preview", roomId, userId)).toBe(
      `ws:seek-preview:${roomId}:${userId}`,
    )
  })

  test("coalesces seek:preview into fewer Redis EVAL calls", async () => {
    const client = mockRedisTokenBucketClient()
    let evalCount = 0
    const originalEval = client.eval.bind(client)
    client.eval = async (...args: Parameters<typeof client.eval>) => {
      evalCount += 1
      return originalEval(...args)
    }

    const { consumeHotWsEventLimit } = await import("./rate-limit")
    const events = 16
    for (let i = 0; i < events; i++) {
      const result = await consumeHotWsEventLimit({
        type: "seek:preview",
        roomId: "room-coalesce",
        userId: "user-coalesce",
        nowMs: 2_000,
      })
      expect(result.allowed).toBe(true)
    }
    // Prepaid batch of 4 → one EVAL per 4 events (no near-empty fallback).
    expect(evalCount).toBe(events / 4)
  })

  test("isolates keys by event type and room/user", async () => {
    mockRedisTokenBucketClient()

    const { HOT_WS_EVENT_LIMITS, consumeHotWsEventLimit } =
      await import("./rate-limit")
    const nowMs = 5_000
    for (let i = 0; i < HOT_WS_EVENT_LIMITS["playback:seek"].capacity; i++) {
      expect(
        (
          await consumeHotWsEventLimit({
            type: "playback:seek",
            roomId: "r1",
            userId: "u1",
            nowMs,
          })
        ).allowed,
      ).toBe(true)
    }
    expect(
      (
        await consumeHotWsEventLimit({
          type: "playback:seek",
          roomId: "r1",
          userId: "u1",
          nowMs,
        })
      ).allowed,
    ).toBe(false)
    expect(
      (
        await consumeHotWsEventLimit({
          type: "playback:seek",
          roomId: "r1",
          userId: "u2",
          nowMs,
        })
      ).allowed,
    ).toBe(true)
    expect(
      (
        await consumeHotWsEventLimit({
          type: "participant:update",
          roomId: "r1",
          userId: "u1",
          nowMs,
        })
      ).allowed,
    ).toBe(true)
  })

  test("unknown event types are not limited", async () => {
    const { consumeHotWsEventLimit } = await import("./rate-limit")
    expect(
      (
        await consumeHotWsEventLimit({
          type: "playlist:select",
          roomId: "r1",
          userId: "u1",
        })
      ).allowed,
    ).toBe(true)
  })

  test("trips participant:update presence floods for the same room+user", async () => {
    mockRedisTokenBucketClient()

    const { HOT_WS_EVENT_LIMITS, consumeHotWsEventLimit } =
      await import("./rate-limit")
    const { capacity } = HOT_WS_EVENT_LIMITS["participant:update"]
    const nowMs = 9_000
    for (let i = 0; i < capacity; i++) {
      expect(
        (
          await consumeHotWsEventLimit({
            type: "participant:update",
            roomId: "r-presence",
            userId: "u-presence",
            nowMs,
          })
        ).allowed,
      ).toBe(true)
    }
    expect(
      (
        await consumeHotWsEventLimit({
          type: "participant:update",
          roomId: "r-presence",
          userId: "u-presence",
          nowMs,
        })
      ).allowed,
    ).toBe(false)
  })

  test("limits local-media:webrtc:signal and sfu:create-transport", async () => {
    mockRedisTokenBucketClient()

    const { HOT_WS_EVENT_LIMITS, consumeHotWsEventLimit, hotWsEventRateKey } =
      await import("./rate-limit")
    const nowMs = 12_000

    const webrtcCap = HOT_WS_EVENT_LIMITS["local-media:webrtc:signal"].capacity
    for (let i = 0; i < webrtcCap; i++) {
      expect(
        (
          await consumeHotWsEventLimit({
            type: "local-media:webrtc:signal",
            roomId: "r-rtc",
            userId: "u-rtc",
            nowMs,
          })
        ).allowed,
      ).toBe(true)
    }
    expect(
      (
        await consumeHotWsEventLimit({
          type: "local-media:webrtc:signal",
          roomId: "r-rtc",
          userId: "u-rtc",
          nowMs,
        })
      ).allowed,
    ).toBe(false)
    expect(hotWsEventRateKey("local-media:webrtc:signal", "r-rtc", "u-rtc")).toBe(
      "ws:local-media-webrtc-signal:r-rtc:u-rtc",
    )

    const sfuCap =
      HOT_WS_EVENT_LIMITS["local-media:sfu:create-transport"].capacity
    for (let i = 0; i < sfuCap; i++) {
      expect(
        (
          await consumeHotWsEventLimit({
            type: "local-media:sfu:create-transport",
            roomId: "r-sfu",
            userId: "u-sfu",
            nowMs,
          })
        ).allowed,
      ).toBe(true)
    }
    expect(
      (
        await consumeHotWsEventLimit({
          type: "local-media:sfu:create-transport",
          roomId: "r-sfu",
          userId: "u-sfu",
          nowMs,
        })
      ).allowed,
    ).toBe(false)

    for (const type of [
      "local-media:sfu:connect-transport",
      "local-media:sfu:produce-data",
      "local-media:sfu:consume-data",
    ] as const) {
      const cap = HOT_WS_EVENT_LIMITS[type].capacity
      for (let i = 0; i < cap; i++) {
        expect(
          (
            await consumeHotWsEventLimit({
              type,
              roomId: `r-${type}`,
              userId: "u-sfu",
              nowMs,
            })
          ).allowed,
        ).toBe(true)
      }
      expect(
        (
          await consumeHotWsEventLimit({
            type,
            roomId: `r-${type}`,
            userId: "u-sfu",
            nowMs,
          })
        ).allowed,
      ).toBe(false)
    }

    // Binary LMC is not a hot WS JSON event type — remains uncapped here.
    expect(
      (
        await consumeHotWsEventLimit({
          type: "local-media:chunk",
          roomId: "r-lmc",
          userId: "u-lmc",
          nowMs,
        })
      ).allowed,
    ).toBe(true)
  })
})

describe("consumeRateLimit", () => {
  test("allows under limit and denies over limit", async () => {
    const counts = new Map<string, number>()
    mock.module("@/server/redis/client", () => ({
      getCommandClient: async () => createIncrMock({ counts }),
    }))

    const { consumeRateLimit } = await import("./rate-limit")

    const first = await consumeRateLimit({
      key: "test:a",
      limit: 2,
      windowMs: 60_000,
    })
    expect(first).toEqual({ allowed: true, remaining: 1 })

    const second = await consumeRateLimit({
      key: "test:a",
      limit: 2,
      windowMs: 60_000,
    })
    expect(second).toEqual({ allowed: true, remaining: 0 })

    const third = await consumeRateLimit({
      key: "test:a",
      limit: 2,
      windowMs: 60_000,
    })
    expect(third).toEqual({ allowed: false, remaining: 0 })
  })

  test("denies by default when Redis is unavailable", async () => {
    mock.module("@/server/redis/client", () => ({
      getCommandClient: async () => createIncrMock({ fail: true }),
    }))

    const { consumeRateLimit } = await import("./rate-limit")

    const result = await consumeRateLimit({
      key: "test:fail-closed",
      limit: 10,
      windowMs: 60_000,
    })
    expect(result).toEqual({ allowed: false, remaining: 0 })
  })

  test("allows when failOpen is true and Redis is unavailable", async () => {
    mock.module("@/server/redis/client", () => ({
      getCommandClient: async () => createIncrMock({ fail: true }),
    }))

    const { consumeRateLimit } = await import("./rate-limit")

    const result = await consumeRateLimit({
      key: "test:fail-open",
      limit: 10,
      windowMs: 60_000,
      failOpen: true,
    })
    expect(result).toEqual({ allowed: true, remaining: 10 })
  })
})
