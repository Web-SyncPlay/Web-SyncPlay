/**
 * HTTP façades for /api/media/local/[id]/hls routes.
 */

import {
  LOCAL_MEDIA_VIEWER_TOKEN_PARAM,
  LOCAL_MEDIA_VIEWER_USER_PARAM,
  resolveServeableLocalMedia,
  viewerAuthFromLocalMediaRequest,
} from "@/server/media/local-media-access"
import {
  buildLocalMediaMasterPlaylist,
  buildLocalMediaVariantPlaylist,
} from "@/server/media/local-media-hls"
import { localMediaJsonError } from "@/server/media/local-media-http"
import { touchLocalMediaEntry } from "@/server/media/local-media-store"

/**
 * GET /api/media/local/{id}/hls
 * Multi-variant master when ABR is ready; otherwise single-variant wrapper.
 */
export async function handleLocalMediaMasterHls(
  request: Request,
  id: string,
): Promise<Response> {
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

/**
 * GET /api/media/local/{id}/hls/{variantId}
 * Single-segment VOD media playlist for one ladder rung.
 */
export async function handleLocalMediaVariantHls(
  request: Request,
  id: string,
  variantId: string,
): Promise<Response> {
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
