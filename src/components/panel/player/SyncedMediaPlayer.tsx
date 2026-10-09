"use client"

import {
  resolvePlayerDurationSec,
  resolvePlayerStreamType,
} from "@/lib/player-utils"
import type { TypedRoomEventSender } from "@/lib/room-events"
import {
  MediaPlayer,
  MediaProvider,
  Track,
  isDASHProvider,
  isHLSProvider,
  type MediaErrorDetail,
  type MediaPlayerInstance,
  type MediaProviderAdapter,
  type PlayerSrc,
} from "@vidstack/react"
import {
  DefaultAudioLayout,
  DefaultVideoLayout,
  defaultLayoutIcons,
} from "@vidstack/react/player/layouts/default"
import { memo, useMemo, type ReactNode, type RefObject } from "react"
import type {
  LoopMode,
  PlaylistItem,
  PlaylistMediaStream,
  RoomState,
  ViewerMediaItemPreference,
} from "@/zod/types"
import type { PlayerSrcInput } from "./player-src"
import type { PendingSyncState } from "./hooks/use-buffering-watchdog"
import {
  useSyncedMediaPlayerHandlers,
  type PlaylistNavSnapshot,
} from "./hooks/use-synced-media-player-handlers"
import type { LocalSeekPhase } from "./playback-control/use-playback-timeline-controller"
import { buildPlayerSettingsSlots } from "./player-settings-slots"

const EMPTY_MEDIA_STREAMS: PlaylistMediaStream[] = []

export type SyncedMediaPlayerProps = {
  playerRef: RefObject<MediaPlayerInstance | null>
  current: PlaylistItem | undefined
  activeStream: PlaylistMediaStream | null
  viewerPrefs: ViewerMediaItemPreference | undefined
  playerSrc: PlayerSrcInput
  activePlaybackSrc: string
  viewType: "audio" | "video"
  useCrossOriginAnonymous: boolean
  playerRemountNonce: number
  videoLoop: LoopMode
  roomPaused: boolean
  roomPlaybackRate: number
  userId: string
  send: TypedRoomEventSender
  canControlPlayback: boolean
  isOtherUserSeeking: boolean
  isMuted: boolean
  preferredVolume: number
  unmute: () => number
  handleVolumeChange: (detail: { volume: number; muted: boolean }) => void
  previousButtonSlot: ReactNode
  nextButtonSlot: ReactNode
  audioDelayMs: number
  onAudioDelayChange: (delayMs: number) => void
  onSelectStreamId: (streamId: string) => void
  playbackRef: RefObject<RoomState["playback"]>
  playlistNavRef: RefObject<PlaylistNavSnapshot>
  isMediaReadyRef: RefObject<boolean>
  bufferingSinceRef: RefObject<number | null>
  participantStatusErrorRef: RefObject<string | null>
  pendingSyncRef: RefObject<PendingSyncState | null>
  reportedItemErrorRef: RefObject<string | null>
  reportedDurationItemIdRef: RefObject<string | null>
  proxyRenewAttemptedRef: RefObject<string | null>
  localBlobFallbackAttemptedRef: RefObject<string | null>
  seekPhase: LocalSeekPhase
  awaitingSeekTargetMs: number | null
  totalItems: number
  applyRoomClock: (
    player: MediaPlayerInstance,
    syncState: PendingSyncState,
    driftThresholdSec?: number,
  ) => void
  enforceServerPlaybackState: () => void
  getCurrentTimeMs: () => number
  commitLiveEdgeSeek: () => void
  selectPlaylistIndex: (index: number) => void
  beginSeek: (targetMs: number) => void
  updateSeek: (targetMs: number) => void
  commitSeek: (targetMs: number) => void
  setIsBuffering: (value: boolean) => void
  setPlaybackError: (value: MediaErrorDetail | undefined) => void
  setMediaDurationMs: (value: number) => void
  setForceLocalRelaySrc: (value: boolean) => void
  setPlayerRemountNonce: (updater: (n: number) => number) => void
}

export const SyncedMediaPlayer = memo(function SyncedMediaPlayer(
  props: SyncedMediaPlayerProps,
) {
  const {
    playerRef,
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
    unmute,
    handleVolumeChange,
    previousButtonSlot,
    nextButtonSlot,
    audioDelayMs,
    onAudioDelayChange,
    onSelectStreamId,
    playbackRef,
    playlistNavRef,
    isMediaReadyRef,
    bufferingSinceRef,
    participantStatusErrorRef,
    pendingSyncRef,
    reportedItemErrorRef,
    reportedDurationItemIdRef,
    proxyRenewAttemptedRef,
    localBlobFallbackAttemptedRef,
    seekPhase,
    awaitingSeekTargetMs,
    totalItems,
    applyRoomClock,
    enforceServerPlaybackState,
    getCurrentTimeMs,
    commitLiveEdgeSeek,
    selectPlaylistIndex,
    beginSeek,
    updateSeek,
    commitSeek,
    setIsBuffering,
    setPlaybackError,
    setMediaDurationMs,
    setForceLocalRelaySrc,
    setPlayerRemountNonce,
  } = props

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

  const handlers = useSyncedMediaPlayerHandlers({
    playerRef,
    current,
    playerSrc,
    activePlaybackSrc,
    send,
    canControlPlayback,
    isMuted,
    preferredVolume,
    unmute,
    handleVolumeChange,
    playbackRef,
    playlistNavRef,
    isMediaReadyRef,
    bufferingSinceRef,
    participantStatusErrorRef,
    pendingSyncRef,
    reportedItemErrorRef,
    reportedDurationItemIdRef,
    proxyRenewAttemptedRef,
    localBlobFallbackAttemptedRef,
    seekPhase,
    awaitingSeekTargetMs,
    totalItems,
    userId,
    applyRoomClock,
    enforceServerPlaybackState,
    getCurrentTimeMs,
    commitLiveEdgeSeek,
    selectPlaylistIndex,
    beginSeek,
    updateSeek,
    commitSeek,
    setIsBuffering,
    setPlaybackError,
    setMediaDurationMs,
    setForceLocalRelaySrc,
    setPlayerRemountNonce,
  })

  return (
    <MediaPlayer
      key={`${current?.id ?? "no-media"}:${activeStream?.id ?? "auto"}:${playerRemountNonce}`}
      ref={playerRef}
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
