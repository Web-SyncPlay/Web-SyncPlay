import { reclaimAbandonedResolves } from "@/server/media/yt-dlp/resolve-lease"
import { derivedResolveReclaimIntervalMs } from "@/server/media/yt-dlp/policy"
import { reresolveRemotePlaylistItem } from "@/server/realtime/services/playlist-resolve"
import type { RoomStateStorePort } from "@/server/realtime/ports"
import { env } from "@/env"
import {
  installShutdownOnce,
  registerShutdownHandler,
} from "@/server/lifecycle"

let reclaimTimer: ReturnType<typeof setInterval> | null = null

function timeoutMs(): number {
  const raw = env.YTDLP_TIMEOUT_MS
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 30_000
}

/**
 * Periodically reclaim playlist resolves whose Valkey lease expired (holder
 * crashed). Safe to call from multiple instances — claim keys serialize work.
 */
export function startResolveReclaimLoop(store: RoomStateStorePort) {
  if (reclaimTimer) return

  const intervalMs = derivedResolveReclaimIntervalMs(timeoutMs())
  const tick = () => {
    void reclaimAbandonedResolves({
      reresolve: (job) =>
        reresolveRemotePlaylistItem({
          store,
          roomId: job.roomId,
          itemId: job.itemId,
        }),
    }).then((n) => {
      if (n > 0) {
        console.info("[yt-dlp] reclaimed abandoned playlist resolves", {
          count: n,
        })
      }
    })
  }

  reclaimTimer = setInterval(tick, intervalMs)
  reclaimTimer.unref?.()
  // Run once shortly after boot so failover is fast after a rolling restart.
  setTimeout(tick, 1_000).unref?.()

  installShutdownOnce()
  registerShutdownHandler(async () => {
    stopResolveReclaimLoop()
  })
}

export function stopResolveReclaimLoop() {
  if (reclaimTimer) {
    clearInterval(reclaimTimer)
    reclaimTimer = null
  }
}
