import { startResolveReclaimLoop } from "@/server/media/yt-dlp/resolve-reclaim"
import { startAppNodeHeartbeat } from "@/server/node-heartbeat"
import { getRoomStateStore } from "@/server/redis/state-store"

const g = globalThis as typeof globalThis & {
  __webSyncPlayMaintenanceBoot?: Promise<void>
}

/**
 * Idempotent: node heartbeat + room/yt-dlp maintenance tick.
 * Safe to call from instrumentation, WS boot, and health probes so
 * ghost presence is reaped even when no browser has opened a socket yet.
 */
export function ensureBackgroundMaintenance(): Promise<void> {
  if (!g.__webSyncPlayMaintenanceBoot) {
    g.__webSyncPlayMaintenanceBoot = (async () => {
      startAppNodeHeartbeat()
      const store = await getRoomStateStore()
      startResolveReclaimLoop(store)
    })().catch((error) => {
      g.__webSyncPlayMaintenanceBoot = undefined
      console.error("[maintenance] boot failed", error)
      throw error
    })
  }
  return g.__webSyncPlayMaintenanceBoot
}
