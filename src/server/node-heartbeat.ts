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

const g = globalThis as typeof globalThis & {
  __webSyncPlayAppNodeHeartbeat?: ReturnType<typeof setInterval>
  __webSyncPlayAliveNodeListCache?: {
    ids: Set<string>
    fetchedAt: number
  }
  __webSyncPlayAliveNodeListInflight?: Promise<Set<string>>
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

export async function listAliveAppNodeIds(): Promise<Set<string>> {
  const cached = g.__webSyncPlayAliveNodeListCache
  if (cached && Date.now() - cached.fetchedAt < ALIVE_NODE_LIST_CACHE_TTL_MS) {
    return new Set(cached.ids)
  }

  if (g.__webSyncPlayAliveNodeListInflight) {
    return new Set(await g.__webSyncPlayAliveNodeListInflight)
  }

  const refresh = (async () => {
    try {
      const ids = await scanAliveAppNodeIdsFromRedis()
      g.__webSyncPlayAliveNodeListCache = {
        ids,
        fetchedAt: Date.now(),
      }
      return ids
    } catch (error) {
      console.warn("[node-heartbeat] list alive failed", error)
      if (cached) return cached.ids
      return new Set<string>()
    } finally {
      g.__webSyncPlayAliveNodeListInflight = undefined
    }
  })()

  g.__webSyncPlayAliveNodeListInflight = refresh
  return new Set(await refresh)
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
