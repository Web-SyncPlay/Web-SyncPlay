import {
  resolveMediaSource,
  type ResolvedMedia,
} from "@/server/media/resolve"
import { invalidateYtDlpExtractCache } from "@/server/media/yt-dlp"
import { beginResolveLease } from "@/server/media/yt-dlp/resolve-lease"

export type { ResolvedMedia }

/**
 * Playlist media resolve surface for realtime services.
 *
 * Production adapter wraps yt-dlp extract cache / resolve leases and
 * {@link resolveMediaSource}. Handlers/services should use
 * {@link getMediaResolvePort} instead of deep-importing those modules.
 */
export interface MediaResolvePort {
  resolveMediaSource(input: {
    url: string
    name?: string
    roomId?: string
    mediaId?: string
    /** When false, skip minting proxy tokens (playability probes). Default true. */
    mintRelay?: boolean
  }): Promise<ResolvedMedia>

  beginResolveLease(input: {
    roomId: string
    itemId: string
    sourceUrl: string
    title?: string
  }): Promise<{ stop: () => void } | null>

  invalidateYtDlpExtractCache(url: string): Promise<void>
}

/** Production adapter — process-local wrappers around media resolve modules. */
export function createMediaResolvePort(): MediaResolvePort {
  return {
    resolveMediaSource,
    beginResolveLease,
    invalidateYtDlpExtractCache,
  }
}
