import type { ProxyTokenPayload } from "@/server/media/proxy-token"
import { recordYtDlpMetric } from "@/server/media/yt-dlp/metrics"
import { reresolveRemotePlaylistItem } from "@/server/realtime/services/playlist-resolve"
import { getRoomStateStore } from "@/server/redis/state-store"
import { consumeRateLimit } from "@/server/security/rate-limit"

/** Upstream statuses that usually mean signed CDN URLs died. */
export function isStaleUpstreamStatus(status: number): boolean {
  return status === 401 || status === 403
}

/**
 * Best-effort: invalidate yt-dlp extract cache and re-resolve the playlist item
 * so clients receive fresh playable/proxy URLs. Rate-limited per room item.
 */
export async function scheduleStaleUpstreamRefresh(
  payload: ProxyTokenPayload,
): Promise<boolean> {
  const roomId = payload.roomId
  const mediaId = payload.mediaId
  if (!roomId || !mediaId) return false

  const limit = consumeRateLimit({
    key: `stale-refresh:${roomId}:${mediaId}`,
    limit: 2,
    windowMs: 60_000,
  })
  if (!limit.allowed) return false

  recordYtDlpMetric("upstreamDeniedRefresh")
  console.warn("[media-proxy] scheduling stale upstream refresh", {
    roomId,
    mediaId,
  })

  try {
    const store = await getRoomStateStore()
    return await reresolveRemotePlaylistItem({
      store,
      roomId,
      itemId: mediaId,
    })
  } catch (error) {
    console.warn("[media-proxy] stale upstream refresh failed", {
      roomId,
      mediaId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}
