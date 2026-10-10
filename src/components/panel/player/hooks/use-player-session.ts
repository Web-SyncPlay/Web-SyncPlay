"use client"

import type { MediaErrorDetail } from "@vidstack/react"
import { useEffect, useMemo, useState } from "react"
import {
  resolveCatalogDurationMs,
  resolveEffectiveDurationMs,
} from "@/shared/playlist-duration"
import type { TypedRoomEventSender } from "@/contracts/room-events"
import type { RoomPanelProps } from "../../../layout/page/types"
import { usePlayerChromeUi } from "./use-player-chrome-ui"
import { usePlayerMediaPipeline } from "./use-player-media-pipeline"
import { usePlayerPermissions } from "./use-player-permissions"
import { usePlayerSessionController } from "./use-player-session-controller"
import { usePlayerSyncPipeline } from "./use-player-sync-pipeline"
import { usePlaylistNavigation } from "./use-playlist-navigation"
import { usePlaybackTimelineController } from "../playback-control/use-playback-timeline-controller"
import { formatMediaErrorDetail } from "../player-src"
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
 * Thin wiring: session controller + media / chrome / sync pipelines + viewModel.
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

  const media = usePlayerMediaPipeline({
    current,
    viewerPrefs,
    userId,
    send,
    playerRef: controller.playerRef,
    localBlobFallbackAttemptedRef: controller.localBlobFallbackAttemptedRef,
    playerRemountNonce,
    setPlayerRemountNonce,
  })

  const { canControlPlayback: canControlByRole } = usePlayerPermissions(myRole)
  const catalogDurationMs = resolveCatalogDurationMs(current)
  const totalDurationMs = resolveEffectiveDurationMs({
    mediaDurationMs,
    catalogDurationMs,
  })

  const canControlPlayback =
    canControlByRole && capabilities.canControlPlayback

  const chrome = usePlayerChromeUi({
    controller,
    playerRemountNonce,
    totalDurationMs,
    seekPreview,
    remoteSeekerName,
    userId,
    current,
    activePlaybackSrc: media.activePlaybackSrc,
    viewType: media.viewType,
    isBuffering,
    setIsBuffering,
    setPlayerRemountNonce,
    roomPlayback: playback,
    navRoomState,
    send,
    canControlPlayback,
  })

  const controlsDisabled =
    !canControlPlayback || chrome.isOtherUserSeeking
  const timeline = usePlaybackTimelineController({
    roomState: navRoomState,
    send,
    controlsDisabled,
  })

  const sync = usePlayerSyncPipeline({
    playerRef: controller.playerRef,
    isMediaReadyRef: controller.isMediaReadyRef,
    bufferingSinceRef: controller.bufferingSinceRef,
    participantStatusErrorRef: controller.participantStatusErrorRef,
    pendingSyncRef: controller.pendingSyncRef,
    playbackRef: controller.playbackRef,
    playbackPaused: playback.paused,
    reportedItemErrorRef: controller.reportedItemErrorRef,
    proxyRenewAttemptedRef: controller.proxyRenewAttemptedRef,
    current,
    activePlaybackSrc: media.activePlaybackSrc,
    viewType: media.viewType,
    playerSrc: media.playerSrc,
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

  // Publish latest implementations without reassigning controller method slots.
  syncPlayerSessionActions(actionsRef, {
    applyRoomClock: sync.applyRoomClock,
    enforceServerPlaybackState: sync.enforceServerPlaybackState,
    getCurrentTimeMs: sync.getCurrentTimeMs,
    commitLiveEdgeSeek: sync.commitLiveEdgeSeek,
    selectPlaylistIndex: chrome.selectPlaylistIndex,
    beginSeek: timeline.beginSeek,
    updateSeek: timeline.updateSeek,
    commitSeek: timeline.commitSeek,
    setIsBuffering,
    setPlaybackError,
    setMediaDurationMs,
    setForceLocalRelaySrc: media.setForceLocalRelaySrc,
    setPlayerRemountNonce,
    unmute: chrome.unmute,
    handleVolumeChange: chrome.handleVolumeChange,
  })

  const viewModel = useMemo<SyncedMediaPlayerViewModel>(
    () => ({
      current,
      activeStream: media.activeStream,
      viewerPrefs,
      playerSrc: media.playerSrc,
      activePlaybackSrc: media.activePlaybackSrc,
      viewType: media.viewType,
      useCrossOriginAnonymous: media.useCrossOriginAnonymous,
      playerRemountNonce,
      videoLoop,
      roomPaused,
      roomPlaybackRate,
      userId,
      send,
      canControlPlayback,
      isOtherUserSeeking: chrome.isOtherUserSeeking,
      isMuted: chrome.isMuted,
      preferredVolume: chrome.preferredVolume,
      previousButtonSlot: chrome.previousButtonSlot,
      nextButtonSlot: chrome.nextButtonSlot,
      audioDelayMs: media.delayMs,
      onAudioDelayChange: media.setDelayMs,
      onSelectStreamId: media.onSelectStreamId,
      seekPhase: timeline.seekPhase,
      awaitingSeekTargetMs: timeline.awaitingSeekTargetMs,
      totalItems: chrome.totalItems,
    }),
    [
      current,
      media.activeStream,
      viewerPrefs,
      media.playerSrc,
      media.activePlaybackSrc,
      media.viewType,
      media.useCrossOriginAnonymous,
      playerRemountNonce,
      videoLoop,
      roomPaused,
      roomPlaybackRate,
      userId,
      send,
      canControlPlayback,
      chrome.isOtherUserSeeking,
      chrome.isMuted,
      chrome.preferredVolume,
      chrome.previousButtonSlot,
      chrome.nextButtonSlot,
      media.delayMs,
      media.setDelayMs,
      media.onSelectStreamId,
      timeline.seekPhase,
      timeline.awaitingSeekTargetMs,
      chrome.totalItems,
    ],
  )

  return {
    controller,
    viewModel,
    canControlPlayback,
    controlsDisabled,
    isMuted: chrome.isMuted,
    unmute: chrome.unmute,
    activePlaybackSrc: media.activePlaybackSrc,
    isOtherUserSeeking: chrome.isOtherUserSeeking,
    overlaySeekerName: chrome.overlaySeekerName,
    seekProgressPercent: chrome.seekProgressPercent,
    remoteSeekTargetMs: chrome.remoteSeekTargetMs,
    totalTimeLabel: chrome.totalTimeLabel,
    playbackErrorLabel,
    elapsedMs: timeline.elapsedMs,
    totalDurationMs,
    playbackPaused: playback.paused,
    currentName: current?.name,
    handlePlaylistStep: chrome.handlePlaylistStep,
    timeline,
  }
}
