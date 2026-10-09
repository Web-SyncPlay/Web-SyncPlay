"use client"

import type { MediaErrorDetail, MediaPlayerInstance } from "@vidstack/react"
import "@vidstack/react/player/styles/default/layouts/audio.css"
import "@vidstack/react/player/styles/default/layouts/video.css"
import "@vidstack/react/player/styles/default/theme.css"
import { useEffect, useMemo, useRef, useState } from "react"
import { resolveCurrentPlaylistItem } from "@/lib/playlist-current"
import {
  resolveCatalogDurationMs,
  resolveEffectiveDurationMs,
} from "@/lib/playlist-duration"
import { cn } from "@/lib/utils"
import type { RoomPanelProps } from "../../layout/page/types"
import {
  useBufferingWatchdog,
  type PendingSyncState,
} from "./hooks/use-buffering-watchdog"
import { usePlayerAudioDelay } from "./hooks/use-player-audio-delay"
import { usePlayerLocalTracks } from "./hooks/use-player-local-tracks"
import { usePlayerMediaSource } from "./hooks/use-player-media-source"
import { usePlayerPermissions } from "./hooks/use-player-permissions"
import { usePlayerPlaybackSync } from "./hooks/use-player-playback-sync"
import { usePlayerVolume } from "./hooks/use-player-volume"
import { usePlaylistNavigation } from "./hooks/use-playlist-navigation"
import { useRemoteSeekOverlay } from "./hooks/use-remote-seek-overlay"
import { usePlaybackTimelineController } from "./playback-control/use-playback-timeline-controller"
import { formatMediaErrorDetail } from "./player-src"
import { PlayerEmptyState } from "./PlayerEmptyState"
import { PlayerErrorRecoveryOverlay } from "./PlayerErrorRecoveryOverlay"
import { PlayerMediaPreferencesBar } from "./PlayerMediaPreferencesBar"
import { PlayerPanelGlobalStyles } from "./PlayerPanelGlobalStyles"
import { RemoteSeekOverlay } from "./RemoteSeekOverlay"
import { SyncedMediaPlayer } from "./SyncedMediaPlayer"
import { TapToUnmuteButton } from "./TapToUnmuteButton"

export function PlayerPanel({
  roomState,
  roomId,
  send,
  userId,
  userSecret: _userSecret,
  capabilities,
  className,
}: RoomPanelProps & { className?: string }) {
  const current = resolveCurrentPlaylistItem(roomState)
  const viewerPrefs = roomState.participants[userId]?.viewerMedia?.byItemId[
    current?.id ?? ""
  ]

  const playerRef = useRef<MediaPlayerInstance>(null)
  const playbackRef = useRef(roomState.playback)
  const isMediaReadyRef = useRef(false)
  const bufferingSinceRef = useRef<number | null>(null)
  const participantStatusErrorRef = useRef<string | null>(null)
  const pendingSyncRef = useRef<PendingSyncState | null>(null)
  const lastAppliedTimelineAnchorMsRef = useRef<number | null>(null)
  const reportedItemErrorRef = useRef<string | null>(null)
  const reportedDurationItemIdRef = useRef<string | null>(null)
  const proxyRenewAttemptedRef = useRef<string | null>(null)
  const playbackPausedRef = useRef(roomState.playback.paused)
  playbackPausedRef.current = roomState.playback.paused

  const roomPaused = roomState.playback.paused
  const roomPlaybackRate = roomState.playback.playbackRate
  const currentItemId = current?.id

  const [isBuffering, setIsBuffering] = useState(false)
  const [mediaDurationMs, setMediaDurationMs] = useState(0)
  const [playbackError, setPlaybackError] = useState<
    MediaErrorDetail | undefined
  >(undefined)
  const [playerRemountNonce, setPlayerRemountNonce] = useState(0)

  useEffect(() => {
    reportedDurationItemIdRef.current = null
    setMediaDurationMs(0)
  }, [currentItemId])

  const playbackErrorLabel = useMemo(
    () => (playbackError ? formatMediaErrorDetail(playbackError) : undefined),
    [playbackError],
  )

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
  const catalogDurationMs = resolveCatalogDurationMs(current)
  const totalDurationMs = resolveEffectiveDurationMs({
    mediaDurationMs,
    catalogDurationMs,
  })
  const {
    isOtherUserSeeking,
    remoteSeekerName,
    remoteSeekTargetMs,
    seekProgressPercent,
    totalTimeLabel,
  } = useRemoteSeekOverlay({
    mediaDurationMs: totalDurationMs ?? 0,
    roomState,
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
  const {
    audioTracks,
    videoQualities,
    selectAudioTrack,
    selectVideoQuality,
  } = usePlayerLocalTracks({
    playerRef,
    itemId: current?.id,
    syncKey: localTracksAttachKey,
    enabled: Boolean(activePlaybackSrc),
  })
  const { delayMs, setDelayMs, nudgeDelayMs } = usePlayerAudioDelay({
    playerRef,
    attachKey: localTracksAttachKey,
    enabled: Boolean(activePlaybackSrc),
  })

  const canControlPlayback = canControlByRole && capabilities.canControlPlayback
  const controlsDisabled = !canControlPlayback || isOtherUserSeeking
  const timeline = usePlaybackTimelineController({
    roomState,
    send,
    controlsDisabled,
  })

  const {
    applyRoomClock,
    getCurrentTimeMs,
    enforceServerPlaybackState,
    commitLiveEdgeSeek,
  } = usePlayerPlaybackSync({
    playerRef,
    isMediaReadyRef,
    bufferingSinceRef,
    participantStatusErrorRef,
    pendingSyncRef,
    lastAppliedTimelineAnchorMsRef,
    playbackRef,
    playbackPausedRef,
    reportedItemErrorRef,
    proxyRenewAttemptedRef,
    current,
    activePlaybackSrc,
    viewType,
    playerSrc,
    roomState,
    send,
    canControlPlayback,
    isBuffering,
    playbackErrorLabel,
    awaitingSeekTargetMs: timeline.awaitingSeekTargetMs,
    seekPhase: timeline.seekPhase,
    timelineAnchorMs: roomState.playback.timelineAnchorMs,
    commitSeek: timeline.commitSeek,
  })

  const {
    totalItems,
    selectPlaylistIndex,
    handlePlaylistStep,
    previousButtonSlot,
    nextButtonSlot,
  } = usePlaylistNavigation({
    roomState,
    send,
    canControlPlayback,
    enforceServerPlaybackState,
  })

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

  const elapsedMs = timeline.elapsedMs

  return (
    <div
      className={cn(
        "relative aspect-video size-full overflow-hidden rounded-lg bg-black",
        className,
      )}
    >
      {!canControlPlayback && (
        <div className="guest-view-hint pointer-events-none absolute left-3 top-3 z-20 rounded-md bg-black/70 px-2 py-1 text-xs text-white/90">
          Guest view — local tracks, captions, quality & audio delay
        </div>
      )}
      {isMuted && Boolean(activePlaybackSrc) && (
        <TapToUnmuteButton playerRef={playerRef} unmute={unmute} />
      )}
      {current && (
        <PlayerMediaPreferencesBar
          current={current}
          activeStream={activeStream}
          viewerPrefs={viewerPrefs}
          send={send}
          onStreamChange={() =>
            setPlayerRemountNonce((value) => value + 1)
          }
          audioTracks={audioTracks}
          videoQualities={videoQualities}
          onSelectAudioTrack={selectAudioTrack}
          onSelectVideoQuality={selectVideoQuality}
          audioDelayMs={delayMs}
          onAudioDelayChange={setDelayMs}
          onAudioDelayNudge={nudgeDelayMs}
          showAudioDelay={Boolean(activePlaybackSrc)}
        />
      )}
      {activePlaybackSrc ? (
        <SyncedMediaPlayer
          playerRef={playerRef}
          current={current}
          activeStream={activeStream}
          viewerPrefs={viewerPrefs}
          playerSrc={playerSrc}
          activePlaybackSrc={activePlaybackSrc}
          viewType={viewType}
          useCrossOriginAnonymous={useCrossOriginAnonymous}
          playerRemountNonce={playerRemountNonce}
          roomState={roomState}
          roomPaused={roomPaused}
          roomPlaybackRate={roomPlaybackRate}
          userId={userId}
          send={send}
          canControlPlayback={canControlPlayback}
          isOtherUserSeeking={isOtherUserSeeking}
          isMuted={isMuted}
          preferredVolume={preferredVolume}
          unmute={unmute}
          handleVolumeChange={handleVolumeChange}
          previousButtonSlot={previousButtonSlot}
          nextButtonSlot={nextButtonSlot}
          playbackRef={playbackRef}
          isMediaReadyRef={isMediaReadyRef}
          bufferingSinceRef={bufferingSinceRef}
          participantStatusErrorRef={participantStatusErrorRef}
          pendingSyncRef={pendingSyncRef}
          reportedItemErrorRef={reportedItemErrorRef}
          reportedDurationItemIdRef={reportedDurationItemIdRef}
          proxyRenewAttemptedRef={proxyRenewAttemptedRef}
          localBlobFallbackAttemptedRef={localBlobFallbackAttemptedRef}
          seekPhase={timeline.seekPhase}
          awaitingSeekTargetMs={timeline.awaitingSeekTargetMs}
          totalItems={totalItems}
          applyRoomClock={applyRoomClock}
          enforceServerPlaybackState={enforceServerPlaybackState}
          getCurrentTimeMs={getCurrentTimeMs}
          commitLiveEdgeSeek={commitLiveEdgeSeek}
          selectPlaylistIndex={selectPlaylistIndex}
          beginSeek={timeline.beginSeek}
          updateSeek={timeline.updateSeek}
          commitSeek={timeline.commitSeek}
          setIsBuffering={setIsBuffering}
          setPlaybackError={setPlaybackError}
          setMediaDurationMs={setMediaDurationMs}
          setForceLocalRelaySrc={setForceLocalRelaySrc}
          setPlayerRemountNonce={setPlayerRemountNonce}
        />
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
          remoteSeekerName={remoteSeekerName}
          seekProgressPercent={seekProgressPercent}
          remoteSeekTargetMs={remoteSeekTargetMs}
          totalTimeLabel={totalTimeLabel}
        />
      )}
      {playbackErrorLabel && (
        <PlayerErrorRecoveryOverlay
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
      )}
      <PlayerPanelGlobalStyles />
    </div>
  )
}
