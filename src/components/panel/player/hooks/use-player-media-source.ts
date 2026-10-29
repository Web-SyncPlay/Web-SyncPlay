"use client"

import {
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import {
  getLocalMediaMimeType,
  getLocalMediaObjectUrl,
} from "@/client/local-media/local-media-provider"
import { localMediaIdFromSrc } from "@/client/local-media/local-media-resolve"
import {
  getLocalMediaViewerTokenEpoch,
  isPublicLocalMediaApiUrl,
  loadLocalMediaViewerToken,
  subscribeLocalMediaViewerToken,
  withLocalMediaViewerToken,
} from "@/client/local-media/local-media-viewer-token"
import { inferMediaViewType } from "@/client/player/playback-sync"
import type {
  IngestStatus,
  PlaylistItem,
  ViewerMediaItemPreference,
} from "@/contracts/types"

import {
  buildPlayerSrc,
  isSameOriginPlaybackUrl,
  type PlayerSrcInput,
} from "../player-src"

/** True while resolve is in flight or failed — do not load `playableUrl` (page URL). */
export function shouldDeferPlaybackSrc(
  ingestStatus: IngestStatus | undefined,
): boolean {
  return ingestStatus === "resolving" || ingestStatus === "error"
}

/**
 * Guest relay URLs must not load until `vt`/`uid` exist — a bare
 * `/api/media/local/*` request 403s and leaves the media element stuck.
 */
export function shouldDeferLocalMediaRelaySrc(
  url: string,
  hasViewerToken: boolean,
): boolean {
  if (hasViewerToken) return false
  if (!url || url.startsWith("blob:")) return false
  return isPublicLocalMediaApiUrl(url)
}

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
  // Recompute relay URLs when the join-time viewer token lands.
  const viewerTokenEpoch = useSyncExternalStore(
    subscribeLocalMediaViewerToken,
    getLocalMediaViewerTokenEpoch,
    () => 0,
  )

  useEffect(() => {
    queueMicrotask(() => {
      setForceLocalRelaySrc(false)
    })
    localBlobFallbackAttemptedRef.current = null
  }, [current?.id, localBlobFallbackAttemptedRef])

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
    // Epoch is only a cache key — loadLocalMediaViewerToken() reads the store.
    void viewerTokenEpoch
    if (!current) {
      return ""
    }

    // Avoid loading the unresolved page URL (MediaError 4) while yt-dlp runs
    // or after resolve failed (playableUrl still points at the page).
    if (shouldDeferPlaybackSrc(current.ingestStatus)) {
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
    const relayCandidate =
      current.playbackMode === "relay" &&
      fromStream &&
      /^https?:\/\//i.test(fromStream)
        ? (current.playableUrl ?? "")
        : (fromStream ?? current.playableUrl ?? "")

    // Do not fire a tokenless local-media request (permanent MediaError 403).
    if (
      shouldDeferLocalMediaRelaySrc(
        relayCandidate,
        Boolean(loadLocalMediaViewerToken()?.token),
      )
    ) {
      return ""
    }

    return withLocalMediaViewerToken(relayCandidate)
    // viewerTokenEpoch: token may arrive after first render without playlist churn.
  }, [activeStream, current, forceLocalRelaySrc, userId, viewerTokenEpoch])

  const localMimeHint = (() => {
    if (current?.sourceKind !== "local_file") return null
    if (activePlaybackSrc.startsWith("blob:") && current.localMediaId) {
      // Prefer mime for whichever File we are playing (parent or ABR child).
      // When Auto HLS is selected we still play the parent File as progressive.
      const streamSrc = activeStream?.src ?? ""
      const isHlsAuto =
        activeStream?.kind === "adaptive" ||
        /\.m3u8(\?|$)/i.test(streamSrc) ||
        /\/hls(\?|$)/i.test(streamSrc)
      const id = isHlsAuto
        ? current.localMediaId
        : (localMediaIdFromSrc(streamSrc) ?? current.localMediaId)
      return (
        getLocalMediaMimeType(id) ?? getLocalMediaMimeType(current.localMediaId)
      )
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
        // Prefer File MIME over adaptive stream type when playing a blob.
        activePlaybackSrc.startsWith("blob:")
          ? (localMimeHint ?? "video/mp4")
          : (localMimeHint ?? activeStream?.type),
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
