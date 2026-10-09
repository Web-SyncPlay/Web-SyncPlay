import {
  LOCAL_MEDIA_VIEWER_TOKEN_PARAM,
  LOCAL_MEDIA_VIEWER_USER_PARAM,
  resolveServeableLocalMedia,
  viewerAuthFromLocalMediaRequest,
} from "@/server/media/local-media-access"
import { localMediaJsonError } from "@/server/media/local-media-http"
import { buildLocalMediaVariantPlaylist } from "@/server/media/local-media-hls"
import { touchLocalMediaEntry } from "@/server/media/local-media-store"

/**
 * GET /api/media/local/{id}/hls/{variantId}
 * Single-segment VOD media playlist for one ladder rung.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; variantId: string }> },
) {
  const { id, variantId } = await context.params
  const viewer = viewerAuthFromLocalMediaRequest(request)
  const access = await resolveServeableLocalMedia(id, {
    rejectAbrChild: true,
    viewer,
  })
  if (!access.ok) {
    return access.response
  }

  const { entry } = access
  const allowed =
    variantId === id ||
    entry.abr?.variants.some((v) => v.localMediaId === variantId) === true
  if (!allowed) {
    return localMediaJsonError("not_found")
  }

  void touchLocalMediaEntry(id)

  const durationSec =
    entry.abr?.status === "ready" && entry.abr.durationSec > 0
      ? entry.abr.durationSec
      : 1

  const body = buildLocalMediaVariantPlaylist({
    variantLocalMediaId: variantId,
    durationSec,
    viewerQuery: {
      [LOCAL_MEDIA_VIEWER_TOKEN_PARAM]: viewer.token,
      [LOCAL_MEDIA_VIEWER_USER_PARAM]: viewer.userId,
    },
  })

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/vnd.apple.mpegurl",
      "cache-control": "private, max-age=5",
    },
  })
}
