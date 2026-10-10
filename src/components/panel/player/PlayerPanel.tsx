"use client"

import type { MediaErrorDetail } from "@vidstack/react"
import "@vidstack/react/player/styles/default/layouts/audio.css"
import "@vidstack/react/player/styles/default/layouts/video.css"
import "@vidstack/react/player/styles/default/theme.css"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLatestRef } from "@/hooks/use-latest-ref"
import {
  resolveCatalogDurationMs,
  resolveEffectiveDurationMs,
} from "@/shared/playlist-duration"
import { cn } from "@/shared/utils"
import type { TypedRoomEventSender } from "@/contracts/room-events"
import type { RoomPanelProps } from "../../layout/page/types"
import {
  useBufferingWatchdog,
} from "./hooks/use-buffering-watchdog"
import { usePlayerAudioDelay } from "./hooks/use-player-audio-delay"
import { usePlayerLocalTracks } from "./hooks/use-player-local-tracks"
import { usePlayerMediaSource } from "./hooks/use-player-media-source"
import { usePlayerPermissions } from "./hooks/use-player-permissions"
import { usePlayerPlaybackSync } from "./hooks/use-player-playback-sync"
import { usePlayerVolume } from "./hooks/use-player-volume"
import { usePlaylistNavigation } from "./hooks/use-playlist-navigation"
import { useRemoteSeekOverlay } from "./hooks/use-remote-seek-overlay"
import { usePlayerSessionController } from "./hooks/use-player-session-controller"
import { usePlaybackTimelineController } from "./playback-control/use-playback-timeline-controller"
import { formatMediaErrorDetail } from "./player-src"
import { PlayerEmptyState } from "./PlayerEmptyState"
import { PlayerErrorRecoveryOverlay } from "./PlayerErrorRecoveryOverlay"
import { PlayerPanelGlobalStyles } from "./PlayerPanelGlobalStyles"
import { RemoteSeekOverlay } from "./RemoteSeekOverlay"
import { SyncedMediaPlayer } from "./SyncedMediaPlayer"
import { TapToUnmuteButton } from "./TapToUnmuteButton"
import { usePlayerCaptionPreferences } from "./hooks/use-player-caption-preferences"
import {
  bindPlayerSessionActions,
  type SyncedMediaPlayerViewModel,
} from "./player-session-controller"
import {
  playerShellSlicesEqual,
  selectPlayerShellSlice,
  type PlayerShellSlice,
} from "./player-room-selectors"

type PlayerPanelShellProps = {
  slice: PlayerShellSlice
  roomId: string
  userId: string
  send: TypedRoomEventSender
  capabilities: RoomPanelProps["capabilities"]
  className?: string
}

/**
 * Presence-sensitive outer shell: derives a narrow slice so the memoized
 * body does not re-render on participants/lastSeen churn.
 */
export function PlayerPanel({
  roomState,
  roomId,
  send,
  userId,
  userSecret: _userSecret,
  capabilities,
  className,
}: RoomPanelProps & { className?: string }) {
  const slice = selectPlayerShellSlice(roomState, userId)
  return (
    <PlayerPanelShell
      slice={slice}
      roomId={roomId}
      userId={userId}
      send={send}
      capabilities={capabilities}
      className={className}
    />
  )
}

const PlayerPanelShell = memo(
  function PlayerPanelShell({
    slice,
    roomId,
    send,
    userId,
    capabilities,
    className,
  }: PlayerPanelShellProps) {
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

    const controller = usePlayerSessionController({
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

    const { canControlPlayback: canControlByRole } =
      usePlayerPermissions(myRole)
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
      localBlobFallbackAttemptedRef,
    } = usePlayerMediaSource({ current, viewerPrefs, userId })

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

    // Stable unless current/send change — both already re-render the player.
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
      [current, send, setPlayerRemountNonce],
    )

    bindPlayerSessionActions(controller, {
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
      localBlobFallbackAttemptedRef,
    })

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

    return (
      <div
        className={cn(
          "relative aspect-video size-full overflow-hidden rounded-lg bg-black",
          className,
        )}
      >
        {!canControlPlayback && (
          <div className="guest-view-hint pointer-events-none absolute left-3 top-3 z-20 rounded-md bg-black/70 px-2 py-1 text-xs text-white/90">
            Guest view — use player settings for tracks, captions, quality &
            audio delay
          </div>
        )}
        {isMuted && Boolean(activePlaybackSrc) && (
          <TapToUnmuteButton
            playerRef={controller.playerRef}
            unmute={unmute}
          />
        )}
        {activePlaybackSrc ? (
          <SyncedMediaPlayer controller={controller} viewModel={viewModel} />
        ) : (
          <PlayerEmptyState
            send={send}
            canControlPlayback={canControlPlayback}
            roomId={roomId}
            userId={userId}
          />
        )}
        {isOtherUserSeeking && (
          <RemoteSeekOverlay
            remoteSeekerName={overlaySeekerName}
            seekProgressPercent={seekProgressPercent}
            remoteSeekTargetMs={remoteSeekTargetMs}
            totalTimeLabel={totalTimeLabel}
          />
        )}
        {playbackErrorLabel && (
          <PlayerErrorRecoveryOverlay
            currentName={current?.name}
            paused={playback.paused}
            elapsedMs={elapsedMs}
            totalDurationMs={totalDurationMs}
            controlsDisabled={controlsDisabled}
            canControl={canControlPlayback}
            authorizationHint={playbackErrorLabel}
            disabledHint={
              isOtherUserSeeking
                ? `${overlaySeekerName} is seeking: controls are temporarily disabled.`
                : undefined
            }
            onPlay={timeline.play}
            onPause={timeline.pause}
            onSelectAdjacent={handlePlaylistStep}
            onStepBy={timeline.stepBy}
            onSeekPreview={(targetMs, active) => {
              if (!active) {
                // End scrub via onSeekCommit → playback:seek.
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
        )}
        <PlayerPanelGlobalStyles />
      </div>
    )
  },
  (prev, next) =>
    prev.roomId === next.roomId &&
    prev.userId === next.userId &&
    prev.send === next.send &&
    prev.capabilities === next.capabilities &&
    prev.className === next.className &&
    playerShellSlicesEqual(prev.slice, next.slice),
)
