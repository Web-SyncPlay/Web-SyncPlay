import { buildLocalMediaVariantPlaylist } from "@/server/media/local-media-hls"
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
 * GET /api/media/local/{id}/hls/{variantId}
 * Single-segment VOD media playlist for one ladder rung.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; variantId: string }> },
) {
  const { id, variantId } = await context.params
  const entry = await getLocalMediaEntry(id)
  if (!entry || entry.abrParentId) {
    return Response.json(
      {
        error: localMediaErrorMessage("not_found"),
        code: "not_found",
      },
      { status: httpStatusForLocalMediaError("not_found") },
    )
  }

  const allowed =
    variantId === id ||
    entry.abr?.variants.some((v) => v.localMediaId === variantId) === true
  if (!allowed) {
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

  const durationSec =
    entry.abr?.status === "ready" && entry.abr.durationSec > 0
      ? entry.abr.durationSec
      : 1

  const body = buildLocalMediaVariantPlaylist({
    variantLocalMediaId: variantId,
    durationSec,
  })

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/vnd.apple.mpegurl",
      "cache-control": "private, max-age=5",
    },
  })
}
