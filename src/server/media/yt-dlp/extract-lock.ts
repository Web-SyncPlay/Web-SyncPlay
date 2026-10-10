import { env } from "@/env"
import {
  RELEASE_SCRIPT,
  RENEW_SCRIPT,
} from "@/server/media/yt-dlp/lease-lua"
import { recordYtDlpMetric } from "@/server/media/yt-dlp/metrics"
import {
  derivedExtractFailoverWaitMs,
  derivedLockHeartbeatTtlSeconds,
} from "@/server/media/yt-dlp/policy"
import { getCommandClient } from "@/server/redis/client"
import { keys } from "@/server/redis/keys"
import { randomUUID } from "node:crypto"

const WAIT_POLL_MS = 150

/** Per-process single-flight when Valkey lock is unavailable. */
const localInflightByHash = new Map<string, Promise<unknown>>()

export class YtDlpExtractLockTimeoutError extends Error {
  constructor(message = "Timed out waiting for clustered yt-dlp extract") {
    super(message)
    this.name = "YtDlpExtractLockTimeoutError"
  }
}

export type YtDlpLockStore = {
  tryAcquire(
    lockKey: string,
    token: string,
    ttlSeconds: number,
  ): Promise<boolean>
  renew(lockKey: string, token: string, ttlSeconds: number): Promise<boolean>
  release(lockKey: string, token: string): Promise<void>
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function timeoutMs(): number {
  const raw = env.YTDLP_TIMEOUT_MS
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 30_000
}

async function defaultLockStore(): Promise<YtDlpLockStore> {
  const client = await getCommandClient()
  return {
    async tryAcquire(lockKey, token, ttlSeconds) {
      const ok = await client.set(lockKey, token, {
        NX: true,
        EX: ttlSeconds,
      })
      return ok === "OK"
    },
    async renew(lockKey, token, ttlSeconds) {
      const result = await client.eval(RENEW_SCRIPT, {
        keys: [lockKey],
        arguments: [token, String(ttlSeconds)],
      })
      return result === 1
    },
    async release(lockKey, token) {
      await client.eval(RELEASE_SCRIPT, {
        keys: [lockKey],
        arguments: [token],
      })
    },
  }
}

function startHeartbeat(
  store: YtDlpLockStore,
  lockKey: string,
  token: string,
  ttlSeconds: number,
) {
  const intervalMs = Math.max(1_000, Math.floor((ttlSeconds * 1000) / 3))
  const timer = setInterval(() => {
    void store.renew(lockKey, token, ttlSeconds).then((ok) => {
      if (!ok) {
        console.warn("[yt-dlp] lost extract lock during heartbeat", { lockKey })
      }
    })
  }, intervalMs)
  // Don't keep the process alive solely for heartbeats.
  timer.unref?.()
  return () => clearInterval(timer)
}

/**
 * In-process single-flight for a URL hash. Used when the clustered Valkey
 * lock is unavailable so we never fall back to unbounded yt-dlp spawns.
 */
async function withLocalExtractSingleFlight<T>(
  urlHash: string,
  work: () => Promise<T>,
): Promise<T> {
  const existing = localInflightByHash.get(urlHash)
  if (existing) {
    return (await existing) as T
  }
  const pending = work().finally(() => {
    if (localInflightByHash.get(urlHash) === pending) {
      localInflightByHash.delete(urlHash)
    }
  })
  localInflightByHash.set(urlHash, pending)
  return await pending
}

async function runWithoutClusterLock<T>(params: {
  urlHash: string
  work: () => Promise<T>
  readReady: () => Promise<T | null>
}): Promise<T> {
  const ready = await params.readReady()
  if (ready !== null) return ready
  return await withLocalExtractSingleFlight(params.urlHash, params.work)
}

/** Test helper: clear in-process single-flight state. */
export function resetLocalExtractInflightForTest() {
  localInflightByHash.clear()
}

/**
 * Cluster-wide single-flight for a URL hash.
 *
 * - Only the lock holder may run `work` (spawn yt-dlp).
 * - Lock TTL is short and renewed via heartbeat; crash ⇒ TTL expires ⇒ failover.
 * - Waiters poll the shared cache and attempt acquire when the lock is free.
 * - Waiters never spawn without holding the lock.
 * - When Valkey is unavailable: in-process single-flight only (no unbounded spawn).
 */
export async function withYtDlpExtractLock<T>(
  params: {
    urlHash: string
    work: () => Promise<T>
    readReady: () => Promise<T | null>
  },
  lockStore?: YtDlpLockStore,
): Promise<T> {
  const timeout = timeoutMs()
  const heartbeatTtlSeconds = derivedLockHeartbeatTtlSeconds(timeout)
  const waitBudgetMs = derivedExtractFailoverWaitMs(timeout)
  const lockKey = keys.mediaYtDlpLock(params.urlHash)
  const deadline = Date.now() + waitBudgetMs

  let store: YtDlpLockStore
  try {
    store = lockStore ?? (await defaultLockStore())
  } catch {
    console.warn(
      "[yt-dlp] extract lock unavailable; using in-process single-flight",
    )
    return await runWithoutClusterLock(params)
  }

  let waited = false

  while (Date.now() < deadline) {
    const ready = await params.readReady()
    if (ready !== null) return ready

    const token = randomUUID()
    let acquired = false
    try {
      acquired = await store.tryAcquire(lockKey, token, heartbeatTtlSeconds)
    } catch {
      console.warn(
        "[yt-dlp] extract lock acquire failed; using in-process single-flight",
      )
      return await runWithoutClusterLock(params)
    }

    if (acquired) {
      if (waited) recordYtDlpMetric("lockFailover")
      else recordYtDlpMetric("lockAcquire")
      const stopHeartbeat = startHeartbeat(
        store,
        lockKey,
        token,
        heartbeatTtlSeconds,
      )
      try {
        const again = await params.readReady()
        if (again !== null) return again
        return await params.work()
      } finally {
        stopHeartbeat()
        try {
          await store.release(lockKey, token)
        } catch {
          // ignore
        }
      }
    }

    if (!waited) {
      waited = true
      recordYtDlpMetric("lockWait")
    }
    await sleep(WAIT_POLL_MS)
  }

  const last = await params.readReady()
  if (last !== null) return last

  recordYtDlpMetric("lockWaitTimeout")
  throw new YtDlpExtractLockTimeoutError()
}
