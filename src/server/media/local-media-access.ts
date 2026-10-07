/**
 * Shared serveability checks for public local-media HTTP routes.
 */

import {
  getLocalMediaEntry,
  type LocalMediaEntry,
} from "@/server/media/local-media-store"
import { getRoomStateStore } from "@/server/redis/state-store"
import { localMediaJsonError } from "@/server/media/local-media-http"

export type LocalMediaAccessFailure = {
  ok: false
  response: Response
}

export type LocalMediaAccessOk = {
  ok: true
  entry: LocalMediaEntry
}

/**
 * Load metadata and require a live providing owner (presence + providerReady).
 * Optionally reject ABR child entries (master/variant playlist parents only).
 */
export async function resolveServeableLocalMedia(
  id: string,
  opts?: { rejectAbrChild?: boolean },
): Promise<LocalMediaAccessOk | LocalMediaAccessFailure> {
  const entry = await getLocalMediaEntry(id)
  if (!entry || (opts?.rejectAbrChild && entry.abrParentId)) {
    return { ok: false, response: localMediaJsonError("not_found") }
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
