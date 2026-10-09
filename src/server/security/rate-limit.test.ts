import { afterEach, describe, expect, mock, test } from "bun:test"

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

afterEach(() => {
  mock.restore()
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
