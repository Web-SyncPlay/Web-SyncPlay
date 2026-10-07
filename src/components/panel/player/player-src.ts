import { isProgressiveMediaMime } from "@/lib/media-mime"
import type { MediaErrorDetail } from "@vidstack/react"
import type { PlaylistItem, PlaylistMediaStream } from "@/zod/types"

/** Vidstack needs an explicit MIME when the URL has no file extension (blob:/proxy/local). */
export type PlayerSrcInput = string | { src: string; type: string }

export function normalizeHlsMime(
  mime: string | undefined,
): "application/x-mpegurl" | "application/vnd.apple.mpegurl" | undefined {
  if (!mime) return undefined
  const lower = mime.toLowerCase()
  if (lower === "application/vnd.apple.mpegurl") {
    return "application/vnd.apple.mpegurl"
  }
  if (lower === "application/x-mpegurl" || lower.includes("mpegurl")) {
    return "application/x-mpegurl"
  }
  return undefined
}

export function buildPlayerSrc(
  activePlaybackSrc: string,
  current: PlaylistItem | undefined,
  activeStream: PlaylistMediaStream | null,
  localMimeHint?: string | null,
): PlayerSrcInput {
  if (!activePlaybackSrc) {
    return ""
  }

  const rawMime =
    localMimeHint ??
    activeStream?.type ??
    current?.mediaStreams?.find((s) => s.id === current.defaultStreamId)
      ?.type ??
    current?.mediaStreams?.find((s) => s.isDefault)?.type ??
    current?.mediaStreams?.[0]?.type

  const streamMime = normalizeHlsMime(rawMime)
  if (streamMime) {
    return { src: activePlaybackSrc, type: streamMime }
  }

  const looksAdaptive =
    activeStream?.kind === "adaptive" ||
    /\.m3u8(\?|$)/i.test(activePlaybackSrc) ||
    (activeStream?.protocol ?? "").toLowerCase().includes("m3u8")

  if (looksAdaptive) {
    return { src: activePlaybackSrc, type: "application/x-mpegurl" }
  }

  // blob: and extension-less `/api/media/local/…` need an explicit type or
  // browsers report MediaError 4 ("Failed to load resource").
  if (isProgressiveMediaMime(rawMime) && rawMime) {
    return { src: activePlaybackSrc, type: rawMime }
  }

  return activePlaybackSrc
}

export function isSameOriginPlaybackUrl(url: string): boolean {
  if (typeof window === "undefined") {
    return false
  }
  // Relative and blob URLs are always same-origin for this document.
  if (url.startsWith("/") || url.startsWith("blob:")) {
    return true
  }
  try {
    return new URL(url).origin === window.location.origin
  } catch {
    return false
  }
}

export function mediaErrorCode(detail: MediaErrorDetail): number | null {
  if (!detail || typeof detail !== "object") return null
  const code = (detail as unknown as Record<string, unknown>).code
  return typeof code === "number" && Number.isFinite(code) ? code : null
}

export function formatMediaErrorDetail(detail: MediaErrorDetail) {
  if (typeof detail === "string") {
    return detail
  }

  if (detail && typeof detail === "object") {
    const asRecord = detail as unknown as Record<string, unknown>
    const code = asRecord.code
    const message = asRecord.message
    const fallback = asRecord.error

    if (typeof message === "string" && message.trim().length > 0) {
      if (typeof code === "number" && Number.isFinite(code)) {
        return `Media error ${code}: ${message}`
      }
      return message
    }

    if (typeof fallback === "string" && fallback.trim().length > 0) {
      return fallback
    }

    if (typeof code === "number" && Number.isFinite(code)) {
      return `Media error ${code}`
    }
  }

  return "Playback error"
}
