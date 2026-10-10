"use client"

import type { MediaErrorDetail } from "@vidstack/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLatestRef } from "@/hooks/use-latest-ref"
import {
  resolveCatalogDurationMs,
  resolveEffectiveDurationMs,
} from "@/shared/playlist-duration"
import type { TypedRoomEventSender } from "@/contracts/room-events"
import type { RoomPanelProps } from "../../../layout/page/types"
import { useBufferingWatchdog } from "./use-buffering-watchdog"
import { usePlayerAudioDelay } from "./use-player-audio-delay"
import { usePlayerLocalTracks } from "./use-player-local-tracks"
import { usePlayerMediaSource } from "./use-player-media-source"
import { usePlayerPermissions } from "./use-player-permissions"
import { usePlayerPlaybackSync } from "./use-player-playback-sync"
import { usePlayerVolume } from "./use-player-volume"
import { usePlaylistNavigation } from "./use-playlist-navigation"
import { useRemoteSeekOverlay } from "./use-remote-seek-overlay"
import { usePlayerSessionController } from "./use-player-session-controller"
import { usePlaybackTimelineController } from "../playback-control/use-playback-timeline-controller"
import { formatMediaErrorDetail } from "../player-src"
import { usePlayerCaptionPreferences } from "./use-player-caption-preferences"
import {
  syncPlayerSessionActions,
  type PlayerSessionController,
  type SyncedMediaPlayerViewModel,
} from "../player-session-controller"
import type { PlayerShellSlice } from "../player-room-selectors"

export type UsePlayerSessionArgs = {
  slice: PlayerShellSlice
  userId: string
  send: TypedRoomEventSender
  capabilities: RoomPanelProps["capabilities"]
}

export type PlayerSessionUi = {
  controller: PlayerSessionController
  viewModel: SyncedMediaPlayerViewModel
  canControlPlayback: boolean
  controlsDisabled: boolean
  isMuted: boolean
  unmute: () => number
  activePlaybackSrc: string
  isOtherUserSeeking: boolean
  overlaySeekerName: string
  seekProgressPercent: number
  remoteSeekTargetMs: number
  totalTimeLabel: string
  playbackErrorLabel: string | undefined
  elapsedMs: number
  totalDurationMs: number | null
  playbackPaused: boolean
  currentName: string | undefined
  handlePlaylistStep: ReturnType<typeof usePlaylistNavigation>["handlePlaylistStep"]
  timeline: ReturnType<typeof usePlaybackTimelineController>
}

/**
 * Coordinates player hooks + session controller so PlayerPanel stays mostly JSX.
 * Syncs action implementations into a stable controller via actionsRef (no
 * per-render method reassignment on the controller bag).
 */
export function usePlayerSession({
  slice,
  userId,
  send,
  capabilities,
}: UsePlayerSessionArgs): PlayerSessionUi {
  const {
    playback,
    currentItem: current,
    currentIndex,
    playlist,
    seekPreview,
    ownerConnected,
    myRole,
    remoteSeekerName,
    viewerPrefs,
  } = slice

  const navRoomState = useMemo(
    () => ({ playback, currentIndex, playlist }),
    [playback, currentIndex, playlist],
  )

  const { controller, actionsRef } = usePlayerSessionController({
    playback,
    playlistNav: {
      currentIndex,
      playlistLoop: playback.playlistLoop,
    },
  })

  const lastAppliedTimelineAnchorMsRef = useRef<number | null>(null)
  const playbackPausedRef = useLatestRef(playback.paused)

  const roomPaused = playback.paused
  const roomPlaybackRate = playback.playbackRate
  const videoLoop = playback.videoLoop
  const currentItemId = current?.id

  const [isBuffering, setIsBuffering] = useState(false)
  const [mediaDurationMs, setMediaDurationMs] = useState(0)
  const [playbackError, setPlaybackError] = useState<
    MediaErrorDetail | undefined
  >(undefined)
  const [playerRemountNonce, setPlayerRemountNonce] = useState(0)

  useEffect(() => {
    // Session bag holds mutable refs; clearing on item change is intentional.
    // eslint-disable-next-line react-hooks/immutability -- ref.current write
    controller.reportedDurationItemIdRef.current = null
    queueMicrotask(() => {
      setMediaDurationMs(0)
    })
  }, [controller, currentItemId])

  const playbackErrorLabel = useMemo(
    () => (playbackError ? formatMediaErrorDetail(playbackError) : undefined),
    [playbackError],
  )

  const { preferredVolume, handleVolumeChange, isMuted, unmute } =
    usePlayerVolume()
  useEffect(() => {
    const player = controller.playerRef.current
    if (!player) {
      return
    }
    if (Math.abs(player.volume - preferredVolume) > 0.001) {
      // eslint-disable-next-line react-hooks/immutability -- media element API
      player.volume = preferredVolume
    }
    if (player.muted !== isMuted) {
      // eslint-disable-next-line react-hooks/immutability -- media element API
      player.muted = isMuted
    }
  }, [controller, preferredVolume, isMuted, playerRemountNonce])

  const { canControlPlayback: canControlByRole } = usePlayerPermissions(myRole)
  const catalogDurationMs = resolveCatalogDurationMs(current)
  const totalDurationMs = resolveEffectiveDurationMs({
    mediaDurationMs,
    catalogDurationMs,
  })
  const {
    isOtherUserSeeking,
    remoteSeekerName: overlaySeekerName,
    remoteSeekTargetMs,
    seekProgressPercent,
    totalTimeLabel,
  } = useRemoteSeekOverlay({
    mediaDurationMs: totalDurationMs ?? 0,
    seekPreview,
    remoteSeekerName,
    userId,
  })

  const {
    activeStream,
    activePlaybackSrc,
    playerSrc,
    useCrossOriginAnonymous,
    viewType,
    setForceLocalRelaySrc,
  } = usePlayerMediaSource({
    current,
    viewerPrefs,
    userId,
    localBlobFallbackAttemptedRef: controller.localBlobFallbackAttemptedRef,
  })

  const localTracksAttachKey = `${current?.id ?? "none"}:${activeStream?.id ?? "auto"}:${playerRemountNonce}`
  usePlayerLocalTracks({
    playerRef: controller.playerRef,
    itemId: current?.id,
    syncKey: localTracksAttachKey,
    enabled: Boolean(activePlaybackSrc),
  })
  const { delayMs, setDelayMs } = usePlayerAudioDelay({
    playerRef: controller.playerRef,
    attachKey: localTracksAttachKey,
    enabled: Boolean(activePlaybackSrc),
  })
  usePlayerCaptionPreferences({
    playerRef: controller.playerRef,
    current,
    viewerPrefs,
    send,
    syncKey: localTracksAttachKey,
    enabled: Boolean(activePlaybackSrc),
  })

  const canControlPlayback =
    canControlByRole && capabilities.canControlPlayback
  const controlsDisabled = !canControlPlayback || isOtherUserSeeking
  const timeline = usePlaybackTimelineController({
    roomState: navRoomState,
    send,
    controlsDisabled,
  })

  const {
    applyRoomClock,
    getCurrentTimeMs,
    enforceServerPlaybackState,
    commitLiveEdgeSeek,
  } = usePlayerPlaybackSync({
    playerRef: controller.playerRef,
    isMediaReadyRef: controller.isMediaReadyRef,
    bufferingSinceRef: controller.bufferingSinceRef,
    participantStatusErrorRef: controller.participantStatusErrorRef,
    pendingSyncRef: controller.pendingSyncRef,
    lastAppliedTimelineAnchorMsRef,
    playbackRef: controller.playbackRef,
    playbackPausedRef,
    reportedItemErrorRef: controller.reportedItemErrorRef,
    proxyRenewAttemptedRef: controller.proxyRenewAttemptedRef,
    current,
    activePlaybackSrc,
    viewType,
    playerSrc,
    playback,
    currentIndex,
    ownerConnected,
    send,
    canControlPlayback,
    isBuffering,
    playbackErrorLabel,
    awaitingSeekTargetMs: timeline.awaitingSeekTargetMs,
    seekPhase: timeline.seekPhase,
    timelineAnchorMs: playback.timelineAnchorMs,
    commitSeek: timeline.commitSeek,
  })

  const {
    totalItems,
    selectPlaylistIndex,
    handlePlaylistStep,
    previousButtonSlot,
    nextButtonSlot,
  } = usePlaylistNavigation({
    roomState: navRoomState,
    send,
    canControlPlayback,
    enforceServerPlaybackState,
  })

  useBufferingWatchdog({
    currentItem: current ? { id: current.id, name: current.name } : null,
    activePlaybackSrc,
    viewType,
    isBuffering,
    isMediaReadyRef: controller.isMediaReadyRef,
    bufferingSinceRef: controller.bufferingSinceRef,
    participantStatusErrorRef: controller.participantStatusErrorRef,
    pendingSyncRef: controller.pendingSyncRef,
    roomPlayback: playback,
    setIsBuffering,
    setPlayerRemountNonce,
  })

  const elapsedMs = timeline.elapsedMs

  const onSelectStreamId = useCallback(
    (streamId: string) => {
      if (!current) {
        return
      }
      send("viewer:media:preferences", {
        itemId: current.id,
        streamId,
      })
      setPlayerRemountNonce((value) => value + 1)
    },
    [current, send],
  )

  // Publish latest implementations without reassigning controller method slots.
  /* eslint-disable react-hooks/refs -- intentional latest-actions sync */
  syncPlayerSessionActions(actionsRef, {
    applyRoomClock,
    enforceServerPlaybackState,
    getCurrentTimeMs,
    commitLiveEdgeSeek,
    selectPlaylistIndex,
    beginSeek: timeline.beginSeek,
    updateSeek: timeline.updateSeek,
    commitSeek: timeline.commitSeek,
    setIsBuffering,
    setPlaybackError,
    setMediaDurationMs,
    setForceLocalRelaySrc,
    setPlayerRemountNonce,
    unmute,
    handleVolumeChange,
  })
  /* eslint-enable react-hooks/refs */

  const viewModel = useMemo<SyncedMediaPlayerViewModel>(
    () => ({
      current,
      activeStream,
      viewerPrefs,
      playerSrc,
      activePlaybackSrc,
      viewType,
      useCrossOriginAnonymous,
      playerRemountNonce,
      videoLoop,
      roomPaused,
      roomPlaybackRate,
      userId,
      send,
      canControlPlayback,
      isOtherUserSeeking,
      isMuted,
      preferredVolume,
      previousButtonSlot,
      nextButtonSlot,
      audioDelayMs: delayMs,
      onAudioDelayChange: setDelayMs,
      onSelectStreamId,
      seekPhase: timeline.seekPhase,
      awaitingSeekTargetMs: timeline.awaitingSeekTargetMs,
      totalItems,
    }),
    [
      current,
      activeStream,
      viewerPrefs,
      playerSrc,
      activePlaybackSrc,
      viewType,
      useCrossOriginAnonymous,
      playerRemountNonce,
      videoLoop,
      roomPaused,
      roomPlaybackRate,
      userId,
      send,
      canControlPlayback,
      isOtherUserSeeking,
      isMuted,
      preferredVolume,
      previousButtonSlot,
      nextButtonSlot,
      delayMs,
      setDelayMs,
      onSelectStreamId,
      timeline.seekPhase,
      timeline.awaitingSeekTargetMs,
      totalItems,
    ],
  )

  return {
    controller,
    viewModel,
    canControlPlayback,
    controlsDisabled,
    isMuted,
    unmute,
    activePlaybackSrc,
    isOtherUserSeeking,
    overlaySeekerName,
    seekProgressPercent,
    remoteSeekTargetMs,
    totalTimeLabel,
    playbackErrorLabel,
    elapsedMs,
    totalDurationMs,
    playbackPaused: playback.paused,
    currentName: current?.name,
    handlePlaylistStep,
    timeline,
  }
}
