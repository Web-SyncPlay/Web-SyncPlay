"use client"

import {
  resolvePlayerDurationSec,
  resolvePlayerStreamType,
} from "@/shared/player-utils"
import {
  MediaPlayer,
  MediaProvider,
  Track,
  isDASHProvider,
  isHLSProvider,
  type MediaProviderAdapter,
  type PlayerSrc,
} from "@vidstack/react"
import {
  DefaultAudioLayout,
  DefaultVideoLayout,
  defaultLayoutIcons,
} from "@vidstack/react/player/layouts/default"
import { memo, useMemo } from "react"
import type { PlaylistMediaStream } from "@/contracts/types"
import { useSyncedMediaPlayerHandlers } from "./hooks/use-synced-media-player-handlers"
import { buildPlayerSettingsSlots } from "./player-settings-slots"
import type {
  PlayerSessionController,
  SyncedMediaPlayerViewModel,
} from "./player-session-controller"

const EMPTY_MEDIA_STREAMS: PlaylistMediaStream[] = []

export type SyncedMediaPlayerProps = {
  controller: PlayerSessionController
  viewModel: SyncedMediaPlayerViewModel
}

export const SyncedMediaPlayer = memo(function SyncedMediaPlayer({
  controller,
  viewModel,
}: SyncedMediaPlayerProps) {
  const {
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
    audioDelayMs,
    onAudioDelayChange,
    onSelectStreamId,
    seekPhase,
    awaitingSeekTargetMs,
    totalItems,
  } = viewModel

  const playerStreamType = resolvePlayerStreamType(current)
  const playerDurationSec = resolvePlayerDurationSec(current)
  const streams = current?.mediaStreams ?? EMPTY_MEDIA_STREAMS
  const selectedStreamId =
    activeStream?.id ?? current?.defaultStreamId ?? ""
  // Explicit useMemo: slots feed Vidstack and must stay referentially stable
  // for memo(SyncedMediaPlayer) even when the React Compiler is active.
  const layoutSlots = useMemo(
    () =>
      buildPlayerSettingsSlots({
        previousButtonSlot,
        nextButtonSlot,
        streams,
        selectedStreamId,
        onSelectStreamId,
        audioDelayMs,
        onAudioDelayChange,
        canControlPlayback,
      }),
    [
      previousButtonSlot,
      nextButtonSlot,
      streams,
      selectedStreamId,
      onSelectStreamId,
      audioDelayMs,
      onAudioDelayChange,
      canControlPlayback,
    ],
  )

  // Same-origin UMD builds (scripts/vendor-player-libs.ts) — never jsDelivr.
  const onProviderChange = (provider: MediaProviderAdapter | null) => {
    if (isHLSProvider(provider)) {
      provider.library = "/vendor/hls.min.js"
    }
    if (isDASHProvider(provider)) {
      provider.library = "/vendor/dash.all.min.js"
    }
  }

  // Indirection so handlers look up actions at call time — controller identity
  // is stable while action slots are rebound each parent render.
  const handlers = useSyncedMediaPlayerHandlers({
    playerRef: controller.playerRef,
    current,
    playerSrc,
    activePlaybackSrc,
    send,
    canControlPlayback,
    isMuted,
    preferredVolume,
    unmute: () => controller.unmute(),
    handleVolumeChange: (detail) => controller.handleVolumeChange(detail),
    playbackRef: controller.playbackRef,
    playlistNavRef: controller.playlistNavRef,
    isMediaReadyRef: controller.isMediaReadyRef,
    bufferingSinceRef: controller.bufferingSinceRef,
    participantStatusErrorRef: controller.participantStatusErrorRef,
    pendingSyncRef: controller.pendingSyncRef,
    reportedItemErrorRef: controller.reportedItemErrorRef,
    reportedDurationItemIdRef: controller.reportedDurationItemIdRef,
    proxyRenewAttemptedRef: controller.proxyRenewAttemptedRef,
    localBlobFallbackAttemptedRef: controller.localBlobFallbackAttemptedRef,
    seekPhase,
    awaitingSeekTargetMs,
    totalItems,
    userId,
    applyRoomClock: (player, syncState, driftThresholdSec) =>
      controller.applyRoomClock(player, syncState, driftThresholdSec),
    enforceServerPlaybackState: () => controller.enforceServerPlaybackState(),
    getCurrentTimeMs: () => controller.getCurrentTimeMs(),
    commitLiveEdgeSeek: () => controller.commitLiveEdgeSeek(),
    selectPlaylistIndex: (index) => controller.selectPlaylistIndex(index),
    beginSeek: (targetMs) => controller.beginSeek(targetMs),
    updateSeek: (targetMs) => controller.updateSeek(targetMs),
    commitSeek: (targetMs) => controller.commitSeek(targetMs),
    setIsBuffering: (value) => controller.setIsBuffering(value),
    setPlaybackError: (value) => controller.setPlaybackError(value),
    setMediaDurationMs: (value) => controller.setMediaDurationMs(value),
    setForceLocalRelaySrc: (value) => controller.setForceLocalRelaySrc(value),
    setPlayerRemountNonce: (updater) => controller.setPlayerRemountNonce(updater),
  })

  return (
    <MediaPlayer
      key={`${current?.id ?? "no-media"}:${activeStream?.id ?? "auto"}:${playerRemountNonce}`}
      ref={controller.playerRef}
      src={playerSrc as PlayerSrc}
      title={current?.name ?? "Web-SyncPlay"}
      viewType={viewType}
      loop={videoLoop !== "off"}
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
      onKeyDownCapture={handlers.onKeyDownCapture}
      onMediaPlayRequest={handlers.onMediaPlayRequest}
      onMediaPauseRequest={handlers.onMediaPauseRequest}
      onMediaSeekingRequest={handlers.onMediaSeekingRequest}
      onMediaSeekRequest={handlers.onMediaSeekRequest}
      onMediaLiveEdgeRequest={handlers.onMediaLiveEdgeRequest}
      onMediaRateChangeRequest={handlers.onMediaRateChangeRequest}
      onPlay={handlers.onPlay}
      onPause={handlers.onPause}
      onPlaying={handlers.onPlaying}
      onWaiting={handlers.onWaiting}
      onProviderChange={onProviderChange}
      onLoadStart={handlers.onLoadStart}
      onCanPlay={handlers.onCanPlay}
      onError={handlers.onError}
      volume={preferredVolume}
      onVolumeChange={handlers.onVolumeChange}
      onMediaUserLoopChangeRequest={handlers.onMediaUserLoopChangeRequest}
      onEnded={handlers.onEnded}
      onDurationChange={handlers.onDurationChange}
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
      {viewType === "audio" ? (
        <DefaultAudioLayout
          icons={defaultLayoutIcons}
          {...(!canControlPlayback ? { playbackRates: [] as number[] } : {})}
          slots={layoutSlots}
        />
      ) : (
        <DefaultVideoLayout
          icons={defaultLayoutIcons}
          {...(!canControlPlayback ? { playbackRates: [] as number[] } : {})}
          slots={layoutSlots}
        />
      )}
    </MediaPlayer>
  )
})
