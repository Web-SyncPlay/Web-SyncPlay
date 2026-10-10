/**
 * Client-side local-media viewer token (minted on join, IP/session bound).
 * Persists in memory + sessionStorage; appends `?vt=` / `uid=` on public
 * local-media URLs; posts the active token to the local-media service worker
 * for HTTP fallback decoration.
 */

import {
  LOCAL_MEDIA_VIEWER_TOKEN_PARAM,
  LOCAL_MEDIA_VIEWER_USER_PARAM,
} from "@/shared/local-media/local-media-viewer-token"

export {
  LOCAL_MEDIA_VIEWER_TOKEN_PARAM,
  LOCAL_MEDIA_VIEWER_USER_PARAM,
}

const STORAGE_KEY = "wsp.localMediaViewerToken"

export type StoredViewerToken = {
  roomId: string
  userId: string
  token: string
}

let memoryRecord: StoredViewerToken | null = null

function isNonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function parseStored(raw: string | null): StoredViewerToken | null {
  if (!isNonEmpty(raw)) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StoredViewerToken>
    if (
      !isNonEmpty(parsed.roomId) ||
      !isNonEmpty(parsed.userId) ||
      !isNonEmpty(parsed.token)
    ) {
      return null
    }
    return {
      roomId: parsed.roomId.trim(),
      userId: parsed.userId.trim(),
      token: parsed.token.trim(),
    }
  } catch {
    return null
  }
}

function syncViewerTokenToServiceWorker(record: StoredViewerToken | null): void {
  if (typeof navigator === "undefined" || !navigator.serviceWorker?.controller) {
    return
  }
  try {
    navigator.serviceWorker.controller.postMessage({
      type: "local-media-sw-viewer-capability",
      record: record
        ? { token: record.token, userId: record.userId }
        : null,
    })
  } catch {
    // ignore
  }
}

export function persistLocalMediaViewerToken(input: StoredViewerToken): void {
  if (
    !isNonEmpty(input.roomId) ||
    !isNonEmpty(input.userId) ||
    !isNonEmpty(input.token)
  ) {
    return
  }
  memoryRecord = {
    roomId: input.roomId.trim(),
    userId: input.userId.trim(),
    token: input.token.trim(),
  }
  if (typeof sessionStorage === "undefined") {
    syncViewerTokenToServiceWorker(memoryRecord)
    return
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(memoryRecord))
  } catch {
    // Quota / private mode — media HTTP will fail closed until remint.
  }
  syncViewerTokenToServiceWorker(memoryRecord)
}

export function loadLocalMediaViewerToken(): StoredViewerToken | null {
  if (memoryRecord) return memoryRecord
  if (typeof sessionStorage === "undefined") return null
  try {
    const loaded = parseStored(sessionStorage.getItem(STORAGE_KEY))
    if (loaded) memoryRecord = loaded
    return loaded
  } catch {
    return null
  }
}

export function clearLocalMediaViewerToken(): void {
  memoryRecord = null
  if (typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }
  syncViewerTokenToServiceWorker(null)
}

/** Append vt + uid query params for public /api/media/local/* URLs. */
export function withLocalMediaViewerToken(
  url: string,
  creds: StoredViewerToken | null = loadLocalMediaViewerToken(),
): string {
  if (!creds?.token || !creds.userId) return url
  if (!url.includes("/api/media/local/")) return url
  if (url.includes("/api/media/local/internal/")) return url
  try {
    const absolute = url.startsWith("http")
      ? new URL(url)
      : new URL(url, "http://local.invalid")
    absolute.searchParams.set(LOCAL_MEDIA_VIEWER_TOKEN_PARAM, creds.token)
    absolute.searchParams.set(LOCAL_MEDIA_VIEWER_USER_PARAM, creds.userId)
    if (url.startsWith("http")) {
      return absolute.toString()
    }
    return `${absolute.pathname}${absolute.search}${absolute.hash}`
  } catch {
    const sep = url.includes("?") ? "&" : "?"
    return `${url}${sep}${LOCAL_MEDIA_VIEWER_TOKEN_PARAM}=${encodeURIComponent(creds.token)}&${LOCAL_MEDIA_VIEWER_USER_PARAM}=${encodeURIComponent(creds.userId)}`
  }
}
