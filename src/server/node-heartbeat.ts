import { getAppNodeId } from "@/server/node-id"
import { getCommandClient } from "@/server/redis/client"
import { keys } from "@/server/redis/keys"
import {
  installShutdownOnce,
  registerShutdownHandler,
} from "@/server/lifecycle"

/** Must outlive a couple of missed heartbeats but clear quickly after crash. */
export const APP_NODE_ALIVE_TTL_SECONDS = 45
const APP_NODE_HEARTBEAT_INTERVAL_MS = 15_000

/** In-process TTL so mutateRoom does not SCAN Valkey on every presence read. */
export const ALIVE_NODE_LIST_CACHE_TTL_MS = 10_000

export type AliveAppNodeListResult = {
  ids: Set<string>
  /**
   * False when Redis SCAN failed and there is no last-good cache.
   * Callers must skip destructive presence cleanup (hDel / dead-node rewrite).
   */
  reliable: boolean
}

const g = globalThis as typeof globalThis & {
  __webSyncPlayAppNodeHeartbeat?: ReturnType<typeof setInterval>
  __webSyncPlayAliveNodeListCache?: {
    ids: Set<string>
    fetchedAt: number
  }
  __webSyncPlayAliveNodeListInflight?: Promise<AliveAppNodeListResult>
}

/** Test-only: drop the alive-node list cache and any in-flight refresh. */
export function invalidateAliveAppNodeListCache(): void {
  g.__webSyncPlayAliveNodeListCache = undefined
  g.__webSyncPlayAliveNodeListInflight = undefined
}

async function scanAliveAppNodeIdsFromRedis(): Promise<Set<string>> {
  const alive = new Set<string>()
  const client = await getCommandClient()
  let cursor = "0"
  do {
    const result = await client.scan(cursor, {
      MATCH: keys.appNodeAliveScanPattern(),
      COUNT: 100,
    })
    cursor = result.cursor
    for (const key of result.keys) {
      // app:node:{uuid}:alive
      const match = /^app:node:(.+):alive$/.exec(key)
      if (match?.[1]) alive.add(match[1])
    }
  } while (cursor !== "0")
  return alive
}

export async function touchAppNodeAlive(): Promise<void> {
  try {
    const client = await getCommandClient()
    await client.set(keys.appNodeAlive(getAppNodeId()), "1", {
      EX: APP_NODE_ALIVE_TTL_SECONDS,
    })
  } catch (error) {
    console.warn("[node-heartbeat] touch failed", error)
  }
}

export async function listAliveAppNodeIds(): Promise<AliveAppNodeListResult> {
  const cached = g.__webSyncPlayAliveNodeListCache
  if (cached && Date.now() - cached.fetchedAt < ALIVE_NODE_LIST_CACHE_TTL_MS) {
    return { ids: new Set(cached.ids), reliable: true }
  }

  if (g.__webSyncPlayAliveNodeListInflight) {
    const inflight = await g.__webSyncPlayAliveNodeListInflight
    return { ids: new Set(inflight.ids), reliable: inflight.reliable }
  }

  const refresh = (async (): Promise<AliveAppNodeListResult> => {
    try {
      const ids = await scanAliveAppNodeIdsFromRedis()
      g.__webSyncPlayAliveNodeListCache = {
        ids,
        fetchedAt: Date.now(),
      }
      return { ids, reliable: true }
    } catch (error) {
      console.warn("[node-heartbeat] list alive failed", error)
      // Last-good cache is still usable for destructive cleanup.
      if (cached) return { ids: cached.ids, reliable: true }
      // Fail closed: empty + unreliable — do not treat remotes as dead.
      return { ids: new Set<string>(), reliable: false }
    } finally {
      g.__webSyncPlayAliveNodeListInflight = undefined
    }
  })()

  g.__webSyncPlayAliveNodeListInflight = refresh
  const result = await refresh
  return { ids: new Set(result.ids), reliable: result.reliable }
}

/** Idempotent process heartbeat so presence refs on dead nodes are ignored. */
export function startAppNodeHeartbeat(): void {
  if (g.__webSyncPlayAppNodeHeartbeat) return

  void touchAppNodeAlive()
  g.__webSyncPlayAppNodeHeartbeat = setInterval(() => {
    void touchAppNodeAlive()
  }, APP_NODE_HEARTBEAT_INTERVAL_MS)
  g.__webSyncPlayAppNodeHeartbeat.unref?.()

  installShutdownOnce()
  registerShutdownHandler(async () => {
    stopAppNodeHeartbeat()
    try {
      const client = await getCommandClient()
      await client.del(keys.appNodeAlive(getAppNodeId()))
    } catch {
      /* ignore */
    }
  })
}

export function stopAppNodeHeartbeat(): void {
  if (g.__webSyncPlayAppNodeHeartbeat) {
    clearInterval(g.__webSyncPlayAppNodeHeartbeat)
    g.__webSyncPlayAppNodeHeartbeat = undefined
  }
}
