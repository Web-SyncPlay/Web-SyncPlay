"use client"

import {
  getLocalMediaMimeType,
  getLocalMediaObjectUrl,
} from "@/client/local-media/local-media-provider"
import { localMediaIdFromSrc } from "@/client/local-media/local-media-resolve"
import { withLocalMediaViewerToken } from "@/client/local-media/local-media-viewer-token"
import { inferMediaViewType } from "@/client/player/playback-sync"
import { useEffect, useMemo, useRef, useState, type RefObject } from "react"
import type { PlaylistItem, ViewerMediaItemPreference } from "@/contracts/types"
import {
  buildPlayerSrc,
  isSameOriginPlaybackUrl,
  playerSrcContentKey,
  type PlayerSrcInput,
} from "../player-src"

/**
 * Resolve active stream, playback URL (blob vs relay), MIME hint, and Vidstack src.
 */
export function usePlayerMediaSource(config: {
  current: PlaylistItem | undefined
  viewerPrefs: ViewerMediaItemPreference | undefined
  userId: string
  /** Prefer the session controller ref so handlers share one bag. */
  localBlobFallbackAttemptedRef?: RefObject<string | null>
}) {
  const { current, viewerPrefs, userId } = config
  const [forceLocalRelaySrc, setForceLocalRelaySrc] = useState(false)
  const ownedLocalBlobFallbackAttemptedRef = useRef<string | null>(null)
  const localBlobFallbackAttemptedRef =
    config.localBlobFallbackAttemptedRef ?? ownedLocalBlobFallbackAttemptedRef

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

  // Depend on primitives that affect buildPlayerSrc (not whole item/stream
  // object identity). Retain the previous PlayerSrcInput when the content key
  // is unchanged so Vidstack does not see a fresh `{ src, type }` each tick.
  const streamKind = activeStream?.kind
  const streamType = activeStream?.type
  const streamProtocol = activeStream?.protocol
  const defaultStreamId = current?.defaultStreamId
  const catalogDefaultType = current?.mediaStreams?.find(
    (s) => s.id === current.defaultStreamId,
  )?.type
  const catalogIsDefaultType = current?.mediaStreams?.find(
    (s) => s.isDefault,
  )?.type
  const catalogFirstType = current?.mediaStreams?.[0]?.type

  const playerSrcPrevRef = useRef<PlayerSrcInput>("")
  const currentRef = useRef(current)
  const activeStreamRef = useRef(activeStream)
  currentRef.current = current
  activeStreamRef.current = activeStream

  const playerSrc: PlayerSrcInput = useMemo(() => {
    const next = buildPlayerSrc(
      activePlaybackSrc,
      currentRef.current,
      activeStreamRef.current,
      localMimeHint ?? activeStreamRef.current?.type,
    )
    const prev = playerSrcPrevRef.current
    if (playerSrcContentKey(next) === playerSrcContentKey(prev)) {
      return prev
    }
    playerSrcPrevRef.current = next
    return next
  }, [
    activePlaybackSrc,
    catalogDefaultType,
    catalogFirstType,
    catalogIsDefaultType,
    defaultStreamId,
    localMimeHint,
    streamKind,
    streamProtocol,
    streamType,
  ])

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
