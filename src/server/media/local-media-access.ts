/**
 * Shared serveability checks for public local-media HTTP routes.
 */

import {
  LOCAL_MEDIA_VIEWER_TOKEN_PARAM,
  LOCAL_MEDIA_VIEWER_USER_PARAM,
} from "@/shared/local-media/local-media-viewer-token"
import {
  getLocalMediaEntry,
  type LocalMediaEntry,
} from "@/server/media/local-media-store"
import { validateViewerCapabilityToken } from "@/server/media/viewer-capability-token"
import { getRoomStateStore } from "@/server/redis/state-store"
import { localMediaJsonError } from "@/server/media/local-media-http"
import { clientIpFromRequest } from "@/server/security/rate-limit"

export {
  LOCAL_MEDIA_VIEWER_TOKEN_PARAM,
  LOCAL_MEDIA_VIEWER_USER_PARAM,
}

export type LocalMediaAccessFailure = {
  ok: false
  response: Response
}

export type LocalMediaAccessOk = {
  ok: true
  entry: LocalMediaEntry
}

export type LocalMediaViewerAuth = {
  /** Opaque viewer capability token (`?vt=`). */
  token: string
  /** Session user id (`?uid=`). */
  userId: string
  /** Current request client IP (must match mint-time boundIp). */
  clientIp: string
}

/**
 * Extract viewer capability credentials from a public local-media request.
 */
export function viewerAuthFromLocalMediaRequest(
  request: Request,
): LocalMediaViewerAuth {
  const url = new URL(request.url)
  return {
    token: url.searchParams.get(LOCAL_MEDIA_VIEWER_TOKEN_PARAM)?.trim() ?? "",
    userId: url.searchParams.get(LOCAL_MEDIA_VIEWER_USER_PARAM)?.trim() ?? "",
    clientIp: clientIpFromRequest(request),
  }
}

/**
 * Load metadata and require a valid per-room viewer capability plus a live
 * providing owner (presence + providerReady).
 * Optionally reject ABR child entries (master/variant playlist parents only).
 */
export async function resolveServeableLocalMedia(
  id: string,
  opts: {
    rejectAbrChild?: boolean
    viewer: LocalMediaViewerAuth
  },
): Promise<LocalMediaAccessOk | LocalMediaAccessFailure> {
  const entry = await getLocalMediaEntry(id)
  if (!entry || (opts.rejectAbrChild && entry.abrParentId)) {
    return { ok: false, response: localMediaJsonError("not_found") }
  }

  const { token, userId, clientIp } = opts.viewer
  if (!token || !userId) {
    return {
      ok: false,
      response: localMediaJsonError("viewer_capability_denied"),
    }
  }

  const capabilityOk = await validateViewerCapabilityToken({
    token,
    roomId: entry.roomId,
    userId,
    clientIp,
  })
  if (!capabilityOk) {
    return {
      ok: false,
      response: localMediaJsonError("viewer_capability_denied"),
    }
  }

  const store = await getRoomStateStore()
  const onlineUsers = await store.getWsPresenceUserIds(entry.roomId)
  if (!onlineUsers.has(entry.ownerUserId)) {
    return { ok: false, response: localMediaJsonError("owner_offline") }
  }
  if (!entry.providerReady) {
    return {
      ok: false,
      response: localMediaJsonError("provider_unavailable"),
    }
  }

  return { ok: true, entry }
}
