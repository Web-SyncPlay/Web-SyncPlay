"use client"

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  getAdjacentPlaylistIndex,
  inferMediaViewType,
  measurePlaybackDriftSec,
} from "@/lib/playback-sync"
import {
  resolvePlayerDurationSec,
  resolvePlayerStreamType,
} from "@/lib/player-utils"
import {
  getLocalMediaMimeType,
  getLocalMediaObjectUrl,
} from "@/lib/local-media-provider"
import { isProgressiveMediaMime } from "@/lib/media-mime"
import { localMediaErrorMessage } from "@/lib/local-media-errors"
import {
  MediaPlayer,
  MediaProvider,
  Track,
  type MediaErrorDetail,
  type MediaPlayerInstance,
  type PlayerSrc,
} from "@vidstack/react"
import {
  DefaultAudioLayout,
  DefaultVideoLayout,
  defaultLayoutIcons,
} from "@vidstack/react/player/layouts/default"
import "@vidstack/react/player/styles/default/layouts/audio.css"
import "@vidstack/react/player/styles/default/layouts/video.css"
import "@vidstack/react/player/styles/default/theme.css"
import { SkipBack, SkipForward, Volume2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { RoomPanelProps } from "../../layout/page/types"
import { ControlPanel } from "../control/ControlPanel"
import { PlaylistAddMediaControls } from "../playlist/PlaylistAddMediaControls"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  useBufferingWatchdog,
  type PendingSyncState,
} from "./hooks/use-buffering-watchdog"
import { usePlaybackDriftCorrection } from "./hooks/use-playback-drift-correction"
import { usePlayerPermissions } from "./hooks/use-player-permissions"
import { usePlayerSync } from "./hooks/use-player-sync"
import { usePlayerVolume } from "./hooks/use-player-volume"
import { useRemoteSeekOverlay } from "./hooks/use-remote-seek-overlay"
import { usePlaybackTimelineController } from "./playback-control/use-playback-timeline-controller"
import { RemoteSeekOverlay } from "./RemoteSeekOverlay"
import type { PlaylistItem, PlaylistMediaStream } from "@/zod/types"

/** Vidstack needs an explicit MIME when the URL has no file extension (blob:/proxy/local). */
type PlayerSrcInput = string | { src: string; type: string }

function normalizeHlsMime(
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

function buildPlayerSrc(
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

function isSameOriginPlaybackUrl(url: string): boolean {
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

function mediaErrorCode(detail: MediaErrorDetail): number | null {
  if (!detail || typeof detail !== "object") return null
  const code = (detail as unknown as Record<string, unknown>).code
  return typeof code === "number" && Number.isFinite(code) ? code : null
}

function formatMediaErrorDetail(detail: MediaErrorDetail) {
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

export function PlayerPanel({
  roomState,
  send,
  userId,
  userSecret: _userSecret,
  capabilities,
  className,
}: RoomPanelProps & { className?: string }) {
  const current = roomState.playlist[roomState.currentIndex]
  const viewerPrefs = roomState.participants[userId]?.viewerMedia?.byItemId[
    current?.id ?? ""
  ]

  const playerRef = useRef<MediaPlayerInstance>(null)
  const playbackRef = useRef(roomState.playback)
  const isMediaReadyRef = useRef(false)
  const bufferingSinceRef = useRef<number | null>(null)
  const participantStatusErrorRef = useRef<string | null>(null)
  const pendingSyncRef = useRef<PendingSyncState | null>(null)
  const playRetryTimerRef = useRef<number | undefined>(undefined)
  const lastAppliedTimelineAnchorMsRef = useRef<number | null>(null)
  const roomPaused = roomState.playback.paused
  const roomPlaybackRate = roomState.playback.playbackRate

  const reportedItemErrorRef = useRef<string | null>(null)
  const proxyRenewAttemptedRef = useRef<string | null>(null)

  const [isBuffering, setIsBuffering] = useState(false)
  const [mediaDurationMs, setMediaDurationMs] = useState(0)
  const [playbackError, setPlaybackError] = useState<
    MediaErrorDetail | undefined
  >(undefined)
  const [playerRemountNonce, setPlayerRemountNonce] = useState(0)
  /** After a host blob: failure, fall back to the same relay URL viewers use. */
  const [forceLocalRelaySrc, setForceLocalRelaySrc] = useState(false)
  const localBlobFallbackAttemptedRef = useRef<string | null>(null)

  const playbackErrorLabel = useMemo(
    () => (playbackError ? formatMediaErrorDetail(playbackError) : undefined),
    [playbackError],
  )

  const { applyClockToPlayer, nudgeTransport } = usePlayerSync()
  const { preferredVolume, handleVolumeChange, isMuted, unmute } =
    usePlayerVolume()
  useEffect(() => {
    const player = playerRef.current
    if (!player) {
      return
    }
    if (Math.abs(player.volume - preferredVolume) > 0.001) {
      player.volume = preferredVolume
    }
    if (player.muted !== isMuted) {
      player.muted = isMuted
    }
  }, [preferredVolume, isMuted, playerRemountNonce])
  const { canControlPlayback: canControlByRole } = usePlayerPermissions(
    roomState,
    userId,
  )
  const {
    isOtherUserSeeking,
    remoteSeekerName,
    remoteSeekTargetMs,
    seekProgressPercent,
    totalTimeLabel,
  } = useRemoteSeekOverlay({ mediaDurationMs, roomState, userId })

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

    // Provider plays from the in-tab File directly — no relay hop.
    // If blob playback fails (MediaError 4), fall back to the relay URL.
    if (
      !forceLocalRelaySrc &&
      current.sourceKind === "local_file" &&
      current.localMediaId &&
      current.localOriginUserId === userId
    ) {
      const localUrl = getLocalMediaObjectUrl(current.localMediaId)
      if (localUrl) {
        return localUrl
      }
    }

    const fromStream = activeStream?.src
    if (
      current.playbackMode === "relay" &&
      fromStream &&
      /^https?:\/\//i.test(fromStream)
    ) {
      return current.playableUrl ?? ""
    }

    return fromStream ?? current.playableUrl ?? ""
  }, [activeStream?.src, current, forceLocalRelaySrc, userId])

  const localMimeHint =
    current?.sourceKind === "local_file" && current.localMediaId
      ? getLocalMediaMimeType(current.localMediaId)
      : null

  const playerSrc = useMemo(
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

  const canControlPlayback = canControlByRole && capabilities.canControlPlayback
  const controlsDisabled = !canControlPlayback || isOtherUserSeeking
  const timeline = usePlaybackTimelineController({
    roomState,
    send,
    controlsDisabled,
  })
  const totalItems = roomState.playlist.length
  const hasPlaylistItems = totalItems > 0
  const canWrapPlaylist = roomState.playback.playlistLoop !== "off"
  const hasPreviousItem =
    hasPlaylistItems && (roomState.currentIndex > 0 || canWrapPlaylist)
  const hasNextItem =
    hasPlaylistItems &&
    (roomState.currentIndex < totalItems - 1 || canWrapPlaylist)

  useEffect(() => {
    if (!current) return
    if (current.sourceKind !== "local_file" || !current.localOriginUserId)
      return
    const ownerConnected =
      roomState.participants[current.localOriginUserId]?.connected ?? false
    if (ownerConnected) return

    const player = playerRef.current
    try {
      player?.pause()
    } catch {
      // Ignore pause failures during remount/provider swaps.
    }

    if (reportedItemErrorRef.current === current.id) return
    reportedItemErrorRef.current = current.id
    toast.error(localMediaErrorMessage("owner_offline"))
  }, [current, roomState.participants])

  useEffect(() => {
    playbackRef.current = roomState.playback
  }, [roomState.playback])

  useEffect(() => {
    setForceLocalRelaySrc(false)
    localBlobFallbackAttemptedRef.current = null
  }, [current?.id])

  useEffect(() => {
    isMediaReadyRef.current = false
    pendingSyncRef.current = null
    lastAppliedTimelineAnchorMsRef.current = null
    bufferingSinceRef.current = Date.now()
    participantStatusErrorRef.current = null
    proxyRenewAttemptedRef.current = null
    if (playRetryTimerRef.current) {
      window.clearTimeout(playRetryTimerRef.current)
      playRetryTimerRef.current = undefined
    }
  }, [current?.id, playerSrc])

  const getCurrentTimeMs = useCallback(() => {
    const player = playerRef.current
    if (!player) {
      return 0
    }

    return Math.max(0, Math.floor(Number(player.currentTime ?? 0) * 1000))
  }, [])

  const scheduleTransportNudge = useCallback(
    (player: MediaPlayerInstance) => {
      if (playbackRef.current.paused) {
        return
      }
      if (playRetryTimerRef.current) {
        window.clearTimeout(playRetryTimerRef.current)
      }
      playRetryTimerRef.current = window.setTimeout(() => {
        playRetryTimerRef.current = undefined
        if (!isMediaReadyRef.current) {
          return
        }
        if (playbackRef.current.paused) {
          return
        }
        if (!player.paused) {
          return
        }
        void nudgeTransport({ player, paused: false }).playAttempt
      }, 350)
    },
    [nudgeTransport],
  )

  const applyRoomClock = useCallback(
    (
      player: MediaPlayerInstance,
      syncState: PendingSyncState,
      driftThresholdSec?: number,
    ) => {
      try {
        applyClockToPlayer({ player, syncState, driftThresholdSec })
        lastAppliedTimelineAnchorMsRef.current = syncState.timelineAnchorMs

        // HLS/proxy often accepts the write asynchronously (or no-ops once).
        // Keep pending until drift correction verifies the playhead caught up.
        const driftSec = measurePlaybackDriftSec(
          Number(player.currentTime ?? 0),
          syncState,
          Date.now(),
          Number(player.duration),
        )
        pendingSyncRef.current =
          driftSec === null || driftSec > 0.8 ? syncState : null

        // Declarative `paused`/`autoPlay` own transport; only nudge when the
        // iframe provider drifts away from room authority.
        if (!syncState.paused && player.paused) {
          void nudgeTransport({ player, paused: false }).playAttempt
          scheduleTransportNudge(player)
        } else if (syncState.paused && player.paused === false) {
          void nudgeTransport({ player, paused: true }).playAttempt
        }
      } catch {
        pendingSyncRef.current = syncState
        console.warn("[player] applyRoomClock failed", {
          itemId: current?.id,
          itemName: current?.name,
          src: activePlaybackSrc,
          viewType,
          syncState,
        })
      }
    },
    [
      activePlaybackSrc,
      applyClockToPlayer,
      current?.id,
      current?.name,
      nudgeTransport,
      scheduleTransportNudge,
      viewType,
    ],
  )

  usePlaybackDriftCorrection({
    playerRef,
    isMediaReadyRef,
    playbackRef,
    pendingSyncRef,
    holdLocalSeek:
      timeline.awaitingSeekTargetMs !== null ||
      timeline.seekPhase === "previewing",
    timelineAnchorMs: roomState.playback.timelineAnchorMs,
    applyRoomClock,
  })

  useEffect(() => {
    const player = playerRef.current
    if (!player) {
      return
    }

    const syncState: PendingSyncState = {
      paused: roomState.playback.paused,
      playbackRate: roomState.playback.playbackRate,
      timelineAnchorMs: roomState.playback.timelineAnchorMs,
      serverNowMs: roomState.playback.serverNowMs,
      videoLoop: roomState.playback.videoLoop !== "off",
    }
    const shouldHoldForLocalSeek =
      timeline.awaitingSeekTargetMs !== null &&
      Math.abs(syncState.timelineAnchorMs - timeline.awaitingSeekTargetMs) >=
        450
    if (shouldHoldForLocalSeek) {
      return
    }

    pendingSyncRef.current = syncState
    if (!isMediaReadyRef.current) {
      return
    }

    // Authority seeks must always apply — the default drift threshold can
    // skip small jumps and leave peers on the previous timeline.
    const anchorChanged =
      lastAppliedTimelineAnchorMsRef.current !== null &&
      lastAppliedTimelineAnchorMsRef.current !== syncState.timelineAnchorMs
    applyRoomClock(player, syncState, anchorChanged ? 0 : undefined)
  }, [
    applyRoomClock,
    roomState.playback.paused,
    roomState.playback.playbackRate,
    roomState.playback.serverNowMs,
    roomState.playback.timelineAnchorMs,
    roomState.playback.videoLoop,
    timeline.awaitingSeekTargetMs,
  ])

  useEffect(() => {
    const player = playerRef.current
    if (!player) {
      return
    }

    // Presence ticks: only send when paused/loading/error change, time drifts,
    // or a slow heartbeat keeps lastSeen fresh.
    const HEARTBEAT_MS = 2_000
    const TIME_DIRTY_MS = 750
    let lastSent = {
      paused: Boolean(player.paused),
      currentTimeMs: Math.max(
        0,
        Math.floor(Number(player.currentTime ?? 0) * 1000),
      ),
      loading: isBuffering,
      // Send null (not undefined) so JSON keeps the key and the server can clear.
      error:
        playbackErrorLabel ?? participantStatusErrorRef.current ?? null,
      at: 0,
    }

    const timer = window.setInterval(() => {
      const next = {
        paused: Boolean(player.paused),
        currentTimeMs: Math.max(
          0,
          Math.floor(Number(player.currentTime ?? 0) * 1000),
        ),
        loading: isBuffering,
        error:
          playbackErrorLabel ?? participantStatusErrorRef.current ?? null,
      }
      const now = Date.now()
      const dirty =
        next.paused !== lastSent.paused ||
        next.loading !== lastSent.loading ||
        next.error !== lastSent.error ||
        Math.abs(next.currentTimeMs - lastSent.currentTimeMs) >= TIME_DIRTY_MS ||
        now - lastSent.at >= HEARTBEAT_MS
      if (!dirty) {
        return
      }

      lastSent = { ...next, at: now }
      send("participant:update", next)
    }, 500)
    return () => window.clearInterval(timer)
  }, [send, roomState.currentIndex, isBuffering, playbackErrorLabel])

  const enforceServerPlaybackState = useCallback(() => {
    const player = playerRef.current
    if (!player || !isMediaReadyRef.current) {
      return
    }

    const syncState: PendingSyncState = {
      paused: playbackRef.current.paused,
      playbackRate: playbackRef.current.playbackRate,
      timelineAnchorMs: playbackRef.current.timelineAnchorMs,
      serverNowMs: playbackRef.current.serverNowMs,
      videoLoop: playbackRef.current.videoLoop !== "off",
    }
    applyRoomClock(player, syncState)
  }, [applyRoomClock])

  useBufferingWatchdog({
    currentItem: current ? { id: current.id, name: current.name } : null,
    activePlaybackSrc,
    viewType,
    isBuffering,
    isMediaReadyRef,
    bufferingSinceRef,
    participantStatusErrorRef,
    pendingSyncRef,
    roomPlayback: roomState.playback,
    setIsBuffering,
    setPlayerRemountNonce,
  })

  const selectPlaylistIndex = useCallback(
    (targetIndex: number) => {
      send("playlist:select", { index: targetIndex })
      if (
        roomState.playback.playlistLoop === "once" &&
        targetIndex === 0 &&
        roomState.currentIndex === totalItems - 1
      ) {
        send("playback:loop:playlist", { mode: "off" })
      }
    },
    [roomState.currentIndex, roomState.playback.playlistLoop, send, totalItems],
  )

  const handlePlaylistStep = useCallback(
    (direction: "previous" | "next") => {
      if (!canControlPlayback) {
        enforceServerPlaybackState()
        return
      }

      const nextIndex = getAdjacentPlaylistIndex({
        currentIndex: roomState.currentIndex,
        totalItems,
        loopMode: roomState.playback.playlistLoop,
        direction,
      })
      if (nextIndex === null || nextIndex === roomState.currentIndex) {
        return
      }

      selectPlaylistIndex(nextIndex)
    },
    [
      canControlPlayback,
      enforceServerPlaybackState,
      roomState.currentIndex,
      roomState.playback.playlistLoop,
      selectPlaylistIndex,
      totalItems,
    ],
  )

  const previousButtonSlot = useMemo(
    () =>
      hasPreviousItem ? (
        <button
          type="button"
          className="vds-button vds-seek-button"
          data-media-control="seek-backward-button"
          aria-label="Previous item"
          title="Previous item"
          disabled={!canControlPlayback}
          onClick={() => handlePlaylistStep("previous")}
        >
          <SkipBack className="size-4" />
        </button>
      ) : null,
    [canControlPlayback, handlePlaylistStep, hasPreviousItem],
  )

  const nextButtonSlot = useMemo(
    () =>
      hasNextItem ? (
        <button
          type="button"
          className="vds-button vds-seek-button"
          data-media-control="seek-forward-button"
          aria-label="Next item"
          title="Next item"
          disabled={!canControlPlayback}
          onClick={() => handlePlaylistStep("next")}
        >
          <SkipForward className="size-4" />
        </button>
      ) : null,
    [canControlPlayback, handlePlaylistStep, hasNextItem],
  )

  const elapsedMs = timeline.elapsedMs
  const catalogDurationMs = Math.floor((current?.durationSeconds ?? 0) * 1000)
  const totalDurationMs = Math.max(mediaDurationMs, catalogDurationMs)
  const playerStreamType = resolvePlayerStreamType(current)
  const playerDurationSec = resolvePlayerDurationSec(current)

  return (
    <div
      className={cn(
        "relative aspect-video size-full bg-black",
        className,
      )}
    >
      {!canControlPlayback && (
        <div className="guest-view-hint pointer-events-none absolute left-3 top-3 z-20 rounded-md bg-black/70 px-2 py-1 text-xs text-white/90">
          Guest view — captions, language & quality only
        </div>
      )}
      {isMuted && Boolean(activePlaybackSrc) && (
        <div className="tap-to-unmute absolute bottom-3 left-1/2 z-30 w-[min(100%-1.5rem,20rem)] -translate-x-1/2">
          <Button
            type="button"
            size="lg"
            className="w-full min-h-11 touch-manipulation shadow-lg"
            onClick={() => {
              const player = playerRef.current
              if (!player) return
              const volume = unmute()
              player.volume = volume
              player.muted = false
            }}
          >
            <Volume2 className="size-4" />
            Tap to unmute
          </Button>
        </div>
      )}
      {current &&
        ((current.mediaStreams?.length ?? 0) > 1 ||
          (current.textTracks?.length ?? 0) > 0) && (
          <div className="absolute right-3 top-3 z-20 flex max-w-[min(100%,20rem)] flex-wrap items-center justify-end gap-2">
            {(current.mediaStreams?.length ?? 0) > 1 && (
              <Select
                value={activeStream?.id ?? current.defaultStreamId ?? ""}
                onValueChange={(streamId) => {
                  if (!current || !streamId) return
                  send("viewer:media:preferences", {
                    itemId: current.id,
                    streamId,
                  })
                  setPlayerRemountNonce((value) => value + 1)
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="h-8 min-w-28 border-white/20 bg-black/70 text-xs text-white"
                >
                  <SelectValue placeholder="Quality" />
                </SelectTrigger>
                <SelectContent>
                  {(current.mediaStreams ?? []).map((stream) => (
                    <SelectItem key={stream.id} value={stream.id}>
                      {stream.label || stream.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {(current.textTracks?.length ?? 0) > 0 && (
              <Select
                value={
                  viewerPrefs?.textTrackId === null
                    ? "off"
                    : (viewerPrefs?.textTrackId ??
                      current.defaultTextTrackId ??
                      "off")
                }
                onValueChange={(textTrackId) => {
                  if (!current) return
                  send("viewer:media:preferences", {
                    itemId: current.id,
                    textTrackId: textTrackId === "off" ? null : textTrackId,
                  })
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="h-8 min-w-28 border-white/20 bg-black/70 text-xs text-white"
                >
                  <SelectValue placeholder="Captions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">Captions off</SelectItem>
                  {(current.textTracks ?? []).map((track) => (
                    <SelectItem key={track.id} value={track.id}>
                      {track.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}
      {activePlaybackSrc ? (
        <MediaPlayer
          key={`${current?.id ?? "no-media"}:${activeStream?.id ?? "auto"}:${playerRemountNonce}`}
          ref={playerRef}
          src={playerSrc as PlayerSrc}
          title={current?.name ?? "Web-SyncPlay"}
          viewType={viewType}
          loop={roomState.playback.videoLoop !== "off"}
          crossOrigin={useCrossOriginAnonymous ? "anonymous" : undefined}
          playsInline
          // Room playback is the transport authority — player follows.
          paused={roomPaused}
          autoPlay={!roomPaused}
          playbackRate={roomPlaybackRate}
          // ARD/catch-up HLS often lacks EXT-X-ENDLIST, so hls.js reports
          // `live` and Vidstack disables seeking. Force VOD unless catalog says live.
          streamType={playerStreamType}
          {...(playerDurationSec !== undefined
            ? { duration: playerDurationSec }
            : {})}
          muted={isMuted}
          className={`size-full ${isOtherUserSeeking ? "remote-seek-controls-hidden" : ""} ${!canControlPlayback ? "guest-controls-guard" : ""}`}
          onKeyDownCapture={(event) => {
            if (canControlPlayback) {
              return
            }
            const key = event.key.toLowerCase()
            const allowedGuestKeys = new Set(["m", "arrowup", "arrowdown"])
            if (allowedGuestKeys.has(key)) {
              return
            }

            event.preventDefault()
            event.stopPropagation()
          }}
          onMediaPlayRequest={(event) => {
            if (!canControlPlayback) {
              event.preventDefault()
              enforceServerPlaybackState()
              return
            }
            if (playbackRef.current.paused) {
              send("playback:play", { currentTimeMs: getCurrentTimeMs() })
            }
          }}
          onMediaPauseRequest={(event) => {
            if (!canControlPlayback) {
              event.preventDefault()
              enforceServerPlaybackState()
              return
            }
            if (!playbackRef.current.paused) {
              send("playback:pause", { currentTimeMs: getCurrentTimeMs() })
            }
          }}
          onMediaSeekingRequest={(detail) => {
            if (!canControlPlayback) {
              enforceServerPlaybackState()
              return
            }
            const targetSec = Number(detail)
            if (!Number.isFinite(targetSec)) {
              return
            }
            const targetMs = Math.max(0, Math.floor(targetSec * 1000))
            if (timeline.seekPhase === "idle") {
              timeline.beginSeek(targetMs)
              return
            }
            timeline.updateSeek(targetMs)
          }}
          onMediaSeekRequest={(detail) => {
            if (!canControlPlayback) {
              enforceServerPlaybackState()
              return
            }
            const targetSec = Number(detail)
            if (!Number.isFinite(targetSec)) {
              return
            }
            timeline.commitSeek(Math.max(0, Math.floor(targetSec * 1000)))
          }}
          onMediaRateChangeRequest={(detail) => {
            if (!canControlPlayback) {
              enforceServerPlaybackState()
              return
            }
            const nextRate = Number(detail)
            if (!Number.isFinite(nextRate)) {
              return
            }
            if (Math.abs(nextRate - playbackRef.current.playbackRate) < 0.001) {
              return
            }
            send("playback:rate", { playbackRate: nextRate })
          }}
          onPlay={() => {
            setIsBuffering(false)
            setPlaybackError(undefined)
            participantStatusErrorRef.current = null
            bufferingSinceRef.current = null
            if (!canControlPlayback && playbackRef.current.paused) {
              enforceServerPlaybackState()
            }
          }}
          onPause={() => {
            setIsBuffering(false)
            bufferingSinceRef.current = null
            // Provider pauses must not mutate room state. Re-follow authority.
            if (!playbackRef.current.paused) {
              enforceServerPlaybackState()
            }
          }}
          onPlaying={() => {
            setIsBuffering(false)
            setPlaybackError(undefined)
            participantStatusErrorRef.current = null
            bufferingSinceRef.current = null
          }}
          onWaiting={() => {
            setIsBuffering(true)
            if (bufferingSinceRef.current === null) {
              bufferingSinceRef.current = Date.now()
            }
          }}
          onLoadStart={() => {
            isMediaReadyRef.current = false
            setIsBuffering(true)
            bufferingSinceRef.current = Date.now()
          }}
          onCanPlay={() => {
            isMediaReadyRef.current = true
            setIsBuffering(false)
            participantStatusErrorRef.current = null
            bufferingSinceRef.current = null
            const player = playerRef.current
            if (!player) {
              return
            }

            const pending = pendingSyncRef.current ?? {
              paused: playbackRef.current.paused,
              playbackRate: playbackRef.current.playbackRate,
              timelineAnchorMs: playbackRef.current.timelineAnchorMs,
              serverNowMs: playbackRef.current.serverNowMs,
              videoLoop: playbackRef.current.videoLoop !== "off",
            }

            const pendingToApply =
              timeline.awaitingSeekTargetMs !== null &&
              Math.abs(
                pending.timelineAnchorMs - timeline.awaitingSeekTargetMs,
              ) >= 450
                ? {
                    ...pending,
                    paused: Boolean(player.paused),
                    timelineAnchorMs: timeline.awaitingSeekTargetMs,
                    serverNowMs: Date.now(),
                  }
                : pending
            // Force-snap after canplay — HLS often becomes seekable only here.
            applyRoomClock(player, pendingToApply, 0)
            // Providers may reset volume on load; re-apply preferred level.
            if (Math.abs(player.volume - preferredVolume) > 0.001) {
              player.volume = preferredVolume
            }
            if (player.muted !== isMuted) {
              player.muted = isMuted
            }
          }}
          onError={(detail: MediaErrorDetail) => {
            setIsBuffering(false)
            participantStatusErrorRef.current = null
            bufferingSinceRef.current = null

            const message = formatMediaErrorDetail(detail)
            const errorCode = mediaErrorCode(detail)
            const isProviderLocalBlob =
              current?.sourceKind === "local_file" &&
              current.localOriginUserId === userId &&
              activePlaybackSrc.startsWith("blob:")

            // Host blob: path failed — retry once via the HTTP relay viewers use.
            if (
              isProviderLocalBlob &&
              current &&
              localBlobFallbackAttemptedRef.current !== current.id
            ) {
              localBlobFallbackAttemptedRef.current = current.id
              console.warn(
                "[player] local blob src failed; falling back to relay URL",
                { itemId: current.id, errorCode, message },
              )
              setPlaybackError(undefined)
              setForceLocalRelaySrc(true)
              setPlayerRemountNonce((n) => n + 1)
              return
            }

            setPlaybackError(detail)

            const usesProxyPath =
              activePlaybackSrc.includes("/api/media/proxy/") ||
              (current?.playableUrl?.includes("/api/media/proxy/") ?? false)
            const looksExpiredOrMissing =
              /\b(401|403|404|409)\b/i.test(message) ||
              /not found|expired|upstream_expired|failed to fetch upstream/i.test(
                message,
              )

            const localFileUserMessage = (() => {
              if (current?.sourceKind !== "local_file") return null
              // Host still on blob (shouldn't reach here after fallback) —
              // don't mislabel as a relay failure.
              if (isProviderLocalBlob) {
                return "Could not play this local file in your browser. Try a different format (e.g. MP4/H.264)."
              }
              const lower = message.toLowerCase()
              if (/\b404\b/.test(message) || lower.includes("not found")) {
                return localMediaErrorMessage("not_found")
              }
              if (/\b503\b/.test(message) || lower.includes("unavailable")) {
                if (lower.includes("offline")) {
                  return localMediaErrorMessage("owner_offline")
                }
                if (lower.includes("timed out") || lower.includes("timeout")) {
                  return localMediaErrorMessage("provider_timeout")
                }
                return localMediaErrorMessage("provider_unavailable")
              }
              return localMediaErrorMessage("relay_failed")
            })()

            if (
              current &&
              canControlPlayback &&
              current.sourceKind === "remote_url" &&
              usesProxyPath &&
              looksExpiredOrMissing &&
              proxyRenewAttemptedRef.current !== current.id
            ) {
              proxyRenewAttemptedRef.current = current.id
              send("playlist:retry", { itemId: current.id })
              setPlaybackError(undefined)
              console.warn("[player] proxy URL stale; requested playlist retry", {
                itemId: current.id,
              })
              return
            }

            if (
              current &&
              canControlPlayback &&
              reportedItemErrorRef.current !== current.id
            ) {
              reportedItemErrorRef.current = current.id
              const userMessage = localFileUserMessage ?? message
              toast.error(userMessage)
              send("playlist:item:error", {
                itemId: current.id,
                error: userMessage,
              })
            }
            console.error("[player] playback error", {
              detail,
              message,
              userMessage: localFileUserMessage ?? message,
              sourceKind: current?.sourceKind,
              source: activePlaybackSrc,
              playerSrc,
            })
          }}
          volume={preferredVolume}
          onVolumeChange={(detail) => {
            // Native mute toggle: restore preferred volume so unmute is never 100% by default.
            if (!detail.muted && isMuted) {
              const player = playerRef.current
              const volume = unmute()
              if (player) {
                player.volume = volume
                player.muted = false
              }
              return
            }
            handleVolumeChange(detail)
          }}
          onMediaUserLoopChangeRequest={(detail) => {
            if (!canControlPlayback) {
              enforceServerPlaybackState()
              return
            }

            const nextMode = detail ? "always" : "off"
            if (nextMode === roomState.playback.videoLoop) {
              return
            }

            send("playback:loop:video", { mode: nextMode })
          }}
          onEnded={() => {
            if (!canControlPlayback) {
              enforceServerPlaybackState()
              return
            }

            // HTML `loop` already restarts when videoLoop is on.
            if (roomState.playback.videoLoop !== "off") {
              return
            }

            const nextIndex = getAdjacentPlaylistIndex({
              currentIndex: roomState.currentIndex,
              totalItems,
              loopMode: roomState.playback.playlistLoop,
              direction: "next",
            })
            if (nextIndex === null) {
              // Pause at EOF so declarative autoPlay + sync don't thrash the
              // last few frames while the room is still "playing".
              if (!playbackRef.current.paused) {
                send("playback:pause", {
                  currentTimeMs: getCurrentTimeMs(),
                })
              }
              return
            }

            selectPlaylistIndex(nextIndex)
          }}
          onDurationChange={(detail) => {
            const durationSec = Number(detail)
            if (!Number.isFinite(durationSec) || durationSec <= 0) {
              setMediaDurationMs(0)
              return
            }

            setMediaDurationMs(Math.floor(durationSec * 1000))
          }}
        >
          <MediaProvider />
          {(current?.textTracks ?? []).map((track) => (
            <Track
              key={track.id}
              src={track.src}
              label={track.label}
              kind={track.kind ?? "subtitles"}
              language={track.language}
              default={Boolean(
                viewerPrefs?.textTrackId !== undefined
                  ? track.id === viewerPrefs.textTrackId
                  : current?.defaultTextTrackId
                    ? track.id === current.defaultTextTrackId
                    : track.isDefault,
              )}
            />
          ))}
          <DefaultAudioLayout
            icons={defaultLayoutIcons}
            {...(!canControlPlayback ? { playbackRates: [] as number[] } : {})}
            slots={{
              beforePlayButton: previousButtonSlot,
              afterPlayButton: nextButtonSlot,
              ...(!canControlPlayback ? { playbackMenuLoop: null } : {}),
            }}
          />
          <DefaultVideoLayout
            icons={defaultLayoutIcons}
            {...(!canControlPlayback ? { playbackRates: [] as number[] } : {})}
            slots={{
              beforePlayButton: previousButtonSlot,
              afterPlayButton: nextButtonSlot,
              ...(!canControlPlayback ? { playbackMenuLoop: null } : {}),
            }}
          />
        </MediaPlayer>
      ) : (
        <Empty className="m-3 border-border/60 bg-black/20 text-white">
          <EmptyHeader>
            <EmptyTitle>No media selected</EmptyTitle>
            <EmptyDescription className="text-white/75">
              Add a media URL or a local file to start playback.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="max-w-xl">
            <PlaylistAddMediaControls
              send={send}
              canManagePlaylist={canControlPlayback}
              className="flex w-full flex-wrap items-center justify-center gap-2"
            />
          </EmptyContent>
        </Empty>
      )}
      {isOtherUserSeeking && (
        <RemoteSeekOverlay
          remoteSeekerName={remoteSeekerName}
          seekProgressPercent={seekProgressPercent}
          remoteSeekTargetMs={remoteSeekTargetMs}
          totalTimeLabel={totalTimeLabel}
        />
      )}
      {playbackErrorLabel && (
        <div className="absolute inset-x-3 bottom-3 z-30 pointer-events-auto sm:inset-x-auto sm:w-104">
          <ControlPanel
            title="Playback Error Recovery"
            currentName={current?.name}
            paused={roomState.playback.paused}
            elapsedMs={elapsedMs}
            totalDurationMs={totalDurationMs}
            controlsDisabled={controlsDisabled}
            canControl={canControlPlayback}
            authorizationHint={playbackErrorLabel}
            disabledHint={
              isOtherUserSeeking
                ? `${remoteSeekerName} is seeking: controls are temporarily disabled.`
                : undefined
            }
            onPlay={timeline.play}
            onPause={timeline.pause}
            onSelectAdjacent={handlePlaylistStep}
            onStepBy={timeline.stepBy}
            onSeekPreview={(targetMs, active) => {
              if (!active) {
                // Commit path handles persistence; ignore preview-end here so
                // we do not double-write timeline via seek:preview active:false.
                return
              }
              if (timeline.seekPhase === "idle") {
                timeline.beginSeek(targetMs)
                return
              }
              timeline.updateSeek(targetMs)
            }}
            onSeekCommit={timeline.commitSeek}
          />
        </div>
      )}
      <style jsx global>{`
        .tap-to-unmute {
          transition: bottom 0.2s ease;
        }

        /* Only show while the player chrome is visible (same cadence as controls). */
        .guest-view-hint {
          opacity: 0;
          transition: opacity 0.2s ease;
        }

        :has(.vds-controls[data-visible]):not(:has(.remote-seek-controls-hidden))
          > .guest-view-hint {
          opacity: 1;
        }

        /* Rise above the control bar + progress slider while they are visible. */
        :has(.vds-controls[data-visible]) > .tap-to-unmute {
          bottom: 6.5rem;
        }

        :has(.vds-video-layout[data-sm] .vds-controls[data-visible])
          > .tap-to-unmute {
          bottom: 7.25rem;
        }

        .remote-seek-controls-hidden .vds-controls {
          opacity: 0 !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }

        .guest-controls-guard .vds-controls,
        .guest-controls-guard .vds-gesture {
          pointer-events: none !important;
        }

        /* Local-only: volume, captions toggle, and settings (quality/audio/CC). */
        .guest-controls-guard .vds-controls .vds-mute-button,
        .guest-controls-guard .vds-controls .vds-volume-slider,
        .guest-controls-guard .vds-controls .vds-volume-popup,
        .guest-controls-guard .vds-controls .vds-volume-group,
        .guest-controls-guard .vds-controls .vds-caption-button,
        .guest-controls-guard .vds-controls .vds-menu-button,
        .guest-controls-guard .vds-controls [data-media-control="mute-button"],
        .guest-controls-guard
          .vds-controls
          [data-media-control="volume-slider"],
        .guest-controls-guard .vds-controls [data-media-control="volume-popup"],
        .guest-controls-guard
          .vds-controls
          [data-media-control="volume-group"],
        .guest-controls-guard
          .vds-controls
          [data-media-control="caption-button"],
        .guest-controls-guard .vds-controls [data-media-control="settings"],
        .guest-controls-guard
          .vds-controls
          [data-media-control="settings-menu"],
        .guest-controls-guard .vds-controls [aria-label*="settings" i],
        .guest-controls-guard .vds-controls [aria-label*="captions" i],
        .guest-controls-guard .vds-controls [aria-label*="subtitles" i] {
          pointer-events: auto !important;
        }

        /* Room-synced transport stays host/moderator-only. */
        .guest-controls-guard .vds-controls .vds-time-slider,
        .guest-controls-guard .vds-controls .vds-play-button,
        .guest-controls-guard .vds-controls .vds-seek-button,
        .guest-controls-guard .vds-controls .vds-playback-rate-slider,
        .guest-controls-guard .vds-controls .vds-playback-rate-radio-group,
        .guest-controls-guard .vds-controls .vds-loop-button,
        .guest-controls-guard .vds-controls [data-media-control="time-slider"],
        .guest-controls-guard .vds-controls [data-media-control="play-button"],
        .guest-controls-guard
          .vds-controls
          [data-media-control="seek-backward-button"],
        .guest-controls-guard
          .vds-controls
          [data-media-control="seek-forward-button"],
        .guest-controls-guard
          .vds-controls
          [data-media-control="playback-rate-slider"],
        .guest-controls-guard
          .vds-controls
          [data-media-control="playback-rate-menu"],
        .guest-controls-guard .vds-controls [aria-label*="playback speed" i],
        .guest-controls-guard .vds-controls [aria-label*="speed" i],
        .guest-controls-guard .vds-controls [aria-label*="loop" i] {
          display: none !important;
        }
      `}</style>
    </div>
  )
}
