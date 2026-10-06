import { expect, test } from "bun:test"
import {
  withYtDlpExtractLock,
  YtDlpExtractLockTimeoutError,
  type YtDlpLockStore,
} from "@/server/media/yt-dlp/extract-lock"
import { resetYtDlpMetricsForTest } from "@/server/media/yt-dlp/metrics"
import { keys } from "@/server/redis/keys"

function memoryLockStore(): YtDlpLockStore & {
  forceExpire: (key: string) => void
} {
  const locks = new Map<string, string>()
  return {
    async tryAcquire(lockKey, token) {
      if (locks.has(lockKey)) return false
      locks.set(lockKey, token)
      return true
    },
    async renew(lockKey, token) {
      return locks.get(lockKey) === token
    },
    async release(lockKey, token) {
      if (locks.get(lockKey) === token) locks.delete(lockKey)
    },
    forceExpire(key) {
      locks.delete(key)
    },
  }
}

test("only the lock holder runs work", async () => {
  resetYtDlpMetricsForTest()
  const store = memoryLockStore()
  let workCount = 0
  let cached: string | null = null

  const holder = withYtDlpExtractLock(
    {
      urlHash: "abc",
      readReady: async () => cached,
      work: async () => {
        workCount += 1
        await new Promise((r) => setTimeout(r, 80))
        cached = "done"
        return "done"
      },
    },
    store,
  )

  const waiter = withYtDlpExtractLock(
    {
      urlHash: "abc",
      readReady: async () => cached,
      work: async () => {
        workCount += 1
        return "should-not-run"
      },
    },
    store,
  )

  const [a, b] = await Promise.all([holder, waiter])
  expect(a).toBe("done")
  expect(b).toBe("done")
  expect(workCount).toBe(1)
})

test("failover acquires after holder lease expires without writing cache", async () => {
  resetYtDlpMetricsForTest()
  const store = memoryLockStore()
  let workCount = 0
  let cached: string | null = null
  const lockKey = keys.mediaYtDlpLock("failover")

  const holder = withYtDlpExtractLock(
    {
      urlHash: "failover",
      readReady: async () => cached,
      work: async () => {
        workCount += 1
        // Simulate crash: drop lock and hang without writing cache.
        store.forceExpire(lockKey)
        await new Promise((r) => setTimeout(r, 2_000))
        return "holder"
      },
    },
    store,
  )

  await new Promise((r) => setTimeout(r, 30))

  const failover = await withYtDlpExtractLock(
    {
      urlHash: "failover",
      readReady: async () => cached,
      work: async () => {
        workCount += 1
        cached = "failover-done"
        return "failover-done"
      },
    },
    store,
  )

  expect(failover).toBe("failover-done")
  expect(workCount).toBeGreaterThanOrEqual(2)

  void holder.catch(() => undefined)
})

test("YtDlpExtractLockTimeoutError is distinct", () => {
  const err = new YtDlpExtractLockTimeoutError()
  expect(err).toBeInstanceOf(Error)
  expect(err.name).toBe("YtDlpExtractLockTimeoutError")
})
