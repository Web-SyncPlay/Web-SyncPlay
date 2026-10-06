import {
  getLocalMediaEntry,
  touchLocalMediaEntry,
} from "@/server/media/local-media-store"
import { getRoomStateStore } from "@/server/redis/state-store"
import {
  httpStatusForLocalMediaError,
  localMediaErrorMessage,
} from "@/lib/local-media-errors"

/**
 * Single-variant VOD HLS wrapper around progressive local media (Elevate B scaffold).
 * Multi-bitrate packaging can extend this with additional EXT-X-STREAM-INF lines.
 *
 * GET /api/media/local/{id}/hls
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const entry = await getLocalMediaEntry(id)
  if (!entry) {
    return Response.json(
      {
        error: localMediaErrorMessage("not_found"),
        code: "not_found",
      },
      { status: httpStatusForLocalMediaError("not_found") },
    )
  }

  const store = await getRoomStateStore()
  const onlineUsers = await store.getWsPresenceUserIds(entry.roomId)
  if (!onlineUsers.has(entry.ownerUserId) || !entry.providerReady) {
    const code = !onlineUsers.has(entry.ownerUserId)
      ? "owner_offline"
      : "provider_unavailable"
    return Response.json(
      { error: localMediaErrorMessage(code), code },
      { status: httpStatusForLocalMediaError(code) },
    )
  }

  void touchLocalMediaEntry(id)

  const mediaPath = `/api/media/local/${encodeURIComponent(id)}`
  const body = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-INDEPENDENT-SEGMENTS",
    '#EXT-X-STREAM-INF:BANDWIDTH=5000000,CODECS="avc1.42E01E,mp4a.40.2"',
    mediaPath,
    "",
  ].join("\n")

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/vnd.apple.mpegurl",
      "cache-control": "private, max-age=5",
    },
  })
}
