import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  ALIVE_NODE_LIST_CACHE_TTL_MS,
  invalidateAliveAppNodeListCache,
} from "@/server/node-heartbeat"

type ScanResult = { cursor: string; keys: string[] }

function createScanMock(keysByPage: ScanResult[]) {
  let scans = 0
  let refreshIndex = 0
  return {
    scan: async (_cursor: string) => {
      scans += 1
      return keysByPage[Math.min(refreshIndex++, keysByPage.length - 1)] ?? {
        cursor: "0",
        keys: [],
      }
    },
    get scanCount() {
      return scans
    },
  }
}

afterEach(() => {
  invalidateAliveAppNodeListCache()
  mock.restore()
})

describe("listAliveAppNodeIds cache", () => {
  test("reuses scan results within TTL", async () => {
    const redis = createScanMock([
      {
        cursor: "0",
        keys: ["app:node:node-a:alive", "app:node:node-b:alive"],
      },
    ])
    mock.module("@/server/redis/client", () => ({
      getCommandClient: async () => redis,
    }))

    const { listAliveAppNodeIds } = await import("@/server/node-heartbeat")

    const first = await listAliveAppNodeIds()
    const second = await listAliveAppNodeIds()

    expect(first).toEqual(new Set(["node-a", "node-b"]))
    expect(second).toEqual(first)
    expect(redis.scanCount).toBe(1)
  })

  test("coalesces concurrent refreshes", async () => {
    let resolveScan: (() => void) | undefined
    const scanGate = new Promise<void>((resolve) => {
      resolveScan = resolve
    })
    let scans = 0
    mock.module("@/server/redis/client", () => ({
      getCommandClient: async () => ({
        scan: async () => {
          scans += 1
          await scanGate
          return { cursor: "0", keys: ["app:node:only:alive"] }
        },
      }),
    }))

    const { listAliveAppNodeIds } = await import("@/server/node-heartbeat")

    const a = listAliveAppNodeIds()
    const b = listAliveAppNodeIds()
    await Bun.sleep(5)
    expect(scans).toBe(1)
    resolveScan?.()
    const [idsA, idsB] = await Promise.all([a, b])
    expect(idsA).toEqual(new Set(["only"]))
    expect(idsB).toEqual(idsA)
    expect(scans).toBe(1)
  })

  test("rescans after TTL expires", async () => {
    const redis = createScanMock([
      { cursor: "0", keys: ["app:node:first:alive"] },
      { cursor: "0", keys: ["app:node:second:alive"] },
    ])
    mock.module("@/server/redis/client", () => ({
      getCommandClient: async () => redis,
    }))

    const { listAliveAppNodeIds } = await import("@/server/node-heartbeat")

    expect(await listAliveAppNodeIds()).toEqual(new Set(["first"]))
    expect(redis.scanCount).toBe(1)

    const originalNow = Date.now
    Date.now = () => originalNow() + ALIVE_NODE_LIST_CACHE_TTL_MS + 1

    try {
      expect(await listAliveAppNodeIds()).toEqual(new Set(["second"]))
      expect(redis.scanCount).toBe(2)
    } finally {
      Date.now = originalNow
    }
  })

  test("returns a copy so callers cannot mutate the cache", async () => {
    mock.module("@/server/redis/client", () => ({
      getCommandClient: async () =>
        createScanMock([{ cursor: "0", keys: ["app:node:n1:alive"] }]),
    }))

    const { listAliveAppNodeIds } = await import("@/server/node-heartbeat")

    const first = await listAliveAppNodeIds()
    first.add("injected")
    const second = await listAliveAppNodeIds()
    expect(second).toEqual(new Set(["n1"]))
    expect(second.has("injected")).toBe(false)
  })
})
