import { reclaimAbandonedResolves } from "@/server/media/yt-dlp/resolve-lease"
import { derivedResolveReclaimIntervalMs } from "@/server/media/yt-dlp/policy"
import { reresolveRemotePlaylistItem } from "@/server/realtime/services/playlist-resolve"
import { cleanupInactiveRooms } from "@/server/realtime/services/cleanup"
import { processDuePrunes } from "@/server/realtime/services/participants"
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
 * Periodic maintenance: reclaim abandoned playlist resolves, process due
 * participant prunes, and sweep inactive rooms (presence reconcile, ownership
 * transfer, empty-room delete). Safe across instances — claim keys / WATCH
 * serialize work.
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

    void processDuePrunes(store).then((n) => {
      if (n > 0) {
        console.info("[participants] pruned disconnected users", { count: n })
      }
    })

    void cleanupInactiveRooms(store).then((result) => {
      if (result.removedRooms > 0 || result.removedParticipants > 0) {
        console.info("[rooms] inactive cleanup sweep", result)
      }
    })

    const hydrate = (
      store as RoomStateStorePort & {
        hydrateDailyDefaultTitlesIfNeeded?: () => Promise<number>
      }
    ).hydrateDailyDefaultTitlesIfNeeded
    if (typeof hydrate === "function") {
      void hydrate.call(store).then((count) => {
        if (count > 0) {
          console.info("[defaults] hydrated daily default titles", { count })
        }
      })
    }
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
