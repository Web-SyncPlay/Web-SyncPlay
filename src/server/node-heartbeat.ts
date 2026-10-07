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

const g = globalThis as typeof globalThis & {
  __webSyncPlayAppNodeHeartbeat?: ReturnType<typeof setInterval>
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
  const alive = new Set<string>()
  try {
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
  } catch (error) {
    console.warn("[node-heartbeat] list alive failed", error)
  }
  return alive
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
