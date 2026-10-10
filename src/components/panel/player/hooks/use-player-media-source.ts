"use client"

import {
  getLocalMediaMimeType,
  getLocalMediaObjectUrl,
} from "@/client/local-media/local-media-provider"
import { localMediaIdFromSrc } from "@/client/local-media/local-media-resolve"
import { withLocalMediaViewerToken } from "@/shared/local-media/local-media-viewer-token"
import { inferMediaViewType } from "@/client/player/playback-sync"
import { useEffect, useMemo, useRef, useState } from "react"
import type { PlaylistItem, ViewerMediaItemPreference } from "@/contracts/types"
import {
  buildPlayerSrc,
  isSameOriginPlaybackUrl,
  type PlayerSrcInput,
} from "../player-src"

/**
 * Resolve active stream, playback URL (blob vs relay), MIME hint, and Vidstack src.
 */
export function usePlayerMediaSource(config: {
  current: PlaylistItem | undefined
  viewerPrefs: ViewerMediaItemPreference | undefined
  userId: string
}) {
  const { current, viewerPrefs, userId } = config
  const [forceLocalRelaySrc, setForceLocalRelaySrc] = useState(false)
  const localBlobFallbackAttemptedRef = useRef<string | null>(null)

  useEffect(() => {
    queueMicrotask(() => {
      setForceLocalRelaySrc(false)
    })
    localBlobFallbackAttemptedRef.current = null
  }, [current?.id])

  const activeStream = useMemo(() => {
    if (!current) {
      return null
    }

    const streams = current.mediaStreams ?? []
    if (streams.length === 0) {
      return null
    }

    return (
      streams.find((stream) => stream.id === viewerPrefs?.streamId) ??
      streams.find((stream) => stream.id === current.defaultStreamId) ??
      streams.find((stream) => stream.isDefault) ??
      streams[0] ??
      null
    )
  }, [current, viewerPrefs?.streamId])

  const activePlaybackSrc = useMemo(() => {
    if (!current) {
      return ""
    }

    // Avoid loading the unresolved page URL (MediaError 4) while yt-dlp runs.
    if (current.ingestStatus === "resolving") {
      return ""
    }

    // Provider plays from the in-tab File directly — no relay hop.
    // If blob playback fails (MediaError 4), fall back to the relay URL.
    // Prefer the File for the selected progressive stream id (parent or ABR child).
    // For Auto HLS, keep the source File blob for best local UX.
    if (
      !forceLocalRelaySrc &&
      current.sourceKind === "local_file" &&
      current.localOriginUserId === userId
    ) {
      const streamSrc = activeStream?.src ?? ""
      const isHlsAuto =
        activeStream?.kind === "adaptive" ||
        /\.m3u8(\?|$)/i.test(streamSrc) ||
        /\/hls(\?|$)/i.test(streamSrc)
      let blobId = current.localMediaId
      if (!isHlsAuto && streamSrc) {
        const fromStream = localMediaIdFromSrc(streamSrc)
        if (fromStream) {
          blobId = fromStream
        }
      }
      if (blobId) {
        const localUrl = getLocalMediaObjectUrl(blobId)
        if (localUrl) {
          return localUrl
        }
      }
    }

    const fromStream = activeStream?.src
    if (
      current.playbackMode === "relay" &&
      fromStream &&
      /^https?:\/\//i.test(fromStream)
    ) {
      return withLocalMediaViewerToken(current.playableUrl ?? "")
    }

    return withLocalMediaViewerToken(fromStream ?? current.playableUrl ?? "")
  }, [activeStream, current, forceLocalRelaySrc, userId])

  const localMimeHint = (() => {
    if (current?.sourceKind !== "local_file") return null
    if (activePlaybackSrc.startsWith("blob:") && current.localMediaId) {
      // Prefer mime for whichever File we are playing (parent or ABR child).
      const streamSrc = activeStream?.src ?? ""
      const id = localMediaIdFromSrc(streamSrc) ?? current.localMediaId
      return getLocalMediaMimeType(id) ?? getLocalMediaMimeType(current.localMediaId)
    }
    return current.localMediaId
      ? getLocalMediaMimeType(current.localMediaId)
      : null
  })()

  const playerSrc: PlayerSrcInput = useMemo(
    () =>
      buildPlayerSrc(
        activePlaybackSrc,
        current,
        activeStream,
        localMimeHint ?? activeStream?.type,
      ),
    [activePlaybackSrc, activeStream, current, localMimeHint],
  )

  const playbackUrlForOrigin =
    typeof playerSrc === "string" ? playerSrc : playerSrc.src
  const useCrossOriginAnonymous =
    playbackUrlForOrigin.length > 0 &&
    !isSameOriginPlaybackUrl(playbackUrlForOrigin)

  const viewType = inferMediaViewType(activePlaybackSrc)

  return {
    activeStream,
    activePlaybackSrc,
    playerSrc,
    useCrossOriginAnonymous,
    viewType,
    forceLocalRelaySrc,
    setForceLocalRelaySrc,
    localBlobFallbackAttemptedRef,
  }
}
