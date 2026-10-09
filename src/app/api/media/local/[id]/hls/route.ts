import {
  LOCAL_MEDIA_VIEWER_TOKEN_PARAM,
  LOCAL_MEDIA_VIEWER_USER_PARAM,
  resolveServeableLocalMedia,
  viewerAuthFromLocalMediaRequest,
} from "@/server/media/local-media-access"
import { buildLocalMediaMasterPlaylist } from "@/server/media/local-media-hls"
import { touchLocalMediaEntry } from "@/server/media/local-media-store"

/**
 * GET /api/media/local/{id}/hls
 * Multi-variant master when ABR is ready; otherwise single-variant wrapper.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const viewer = viewerAuthFromLocalMediaRequest(request)
  const access = await resolveServeableLocalMedia(id, {
    rejectAbrChild: true,
    viewer,
  })
  if (!access.ok) {
    return access.response
  }

  void touchLocalMediaEntry(id)

  const body = buildLocalMediaMasterPlaylist({
    parentId: id,
    variants:
      access.entry.abr?.status === "ready" ? access.entry.abr.variants : null,
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
