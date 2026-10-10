import type { TypedRoomEventSender } from "@/contracts/room-events"
import type {
  MediaErrorDetail,
  MediaPlayerInstance,
} from "@vidstack/react"
import type { MutableRefObject, ReactNode, RefObject } from "react"
import type {
  LoopMode,
  PlaylistItem,
  PlaylistMediaStream,
  RoomState,
  ViewerMediaItemPreference,
} from "@/contracts/types"
import type { PlayerSrcInput } from "./player-src"
import type { PendingSyncState } from "./hooks/use-buffering-watchdog"
import type { PlaylistNavSnapshot } from "./hooks/use-synced-media-player-handlers"
import type { LocalSeekPhase } from "./playback-control/use-playback-timeline-controller"

/**
 * Mutable action implementations looked up by stable controller wrappers.
 * Updated each render via {@link syncPlayerSessionActions}; method slots on
 * {@link PlayerSessionController} keep a fixed identity for the session.
 */
export type PlayerSessionActions = {
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
  unmute: () => number
  handleVolumeChange: (detail: { volume: number; muted: boolean }) => void
}

/**
 * Stable session bag for SyncedMediaPlayer: refs + sync/timeline actions.
 * Identity and action method identities stay fixed across presence-only room
 * updates; latest implementations live in the actions ref.
 *
 * ## Room clock (single apply entry)
 * UI / panel code must not seek the playhead from room authority directly.
 * Authoritative clock writes go only through:
 * - `PlaybackSyncEngine.applyRoomClock` (via controller/`useApplyRoomClock`)
 * - `PlaybackSyncEngine.onAuthorityAnchor` (via `usePlaybackDriftCorrection`)
 */
export type PlayerSessionController = {
  playerRef: RefObject<MediaPlayerInstance | null>
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

  applyRoomClock: PlayerSessionActions["applyRoomClock"]
  enforceServerPlaybackState: PlayerSessionActions["enforceServerPlaybackState"]
  getCurrentTimeMs: PlayerSessionActions["getCurrentTimeMs"]
  commitLiveEdgeSeek: PlayerSessionActions["commitLiveEdgeSeek"]
  selectPlaylistIndex: PlayerSessionActions["selectPlaylistIndex"]
  beginSeek: PlayerSessionActions["beginSeek"]
  updateSeek: PlayerSessionActions["updateSeek"]
  commitSeek: PlayerSessionActions["commitSeek"]
  setIsBuffering: PlayerSessionActions["setIsBuffering"]
  setPlaybackError: PlayerSessionActions["setPlaybackError"]
  setMediaDurationMs: PlayerSessionActions["setMediaDurationMs"]
  setForceLocalRelaySrc: PlayerSessionActions["setForceLocalRelaySrc"]
  setPlayerRemountNonce: PlayerSessionActions["setPlayerRemountNonce"]
  unmute: PlayerSessionActions["unmute"]
  handleVolumeChange: PlayerSessionActions["handleVolumeChange"]
}

/** Render-facing media props — presence must not appear here. */
export type SyncedMediaPlayerViewModel = {
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
  previousButtonSlot: ReactNode
  nextButtonSlot: ReactNode
  audioDelayMs: number
  onAudioDelayChange: (delayMs: number) => void
  onSelectStreamId: (streamId: string) => void
  seekPhase: LocalSeekPhase
  awaitingSeekTargetMs: number | null
  totalItems: number
}

const noopActions: PlayerSessionActions = {
  applyRoomClock: () => {},
  enforceServerPlaybackState: () => {},
  getCurrentTimeMs: () => 0,
  commitLiveEdgeSeek: () => {},
  selectPlaylistIndex: () => {},
  beginSeek: () => {},
  updateSeek: () => {},
  commitSeek: () => {},
  setIsBuffering: () => {},
  setPlaybackError: () => {},
  setMediaDurationMs: () => {},
  setForceLocalRelaySrc: () => {},
  setPlayerRemountNonce: () => {},
  unmute: () => 0,
  handleVolumeChange: () => {},
}

export function createPlayerSessionActionsRef(): MutableRefObject<PlayerSessionActions> {
  return { current: noopActions }
}

/**
 * Build a session controller whose action methods are stable wrappers over
 * `actionsRef`. Call {@link syncPlayerSessionActions} each render instead of
 * reassigning method slots.
 */
export function createPlayerSessionController(
  refs: {
    playerRef: RefObject<MediaPlayerInstance | null>
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
  },
  actionsRef: MutableRefObject<PlayerSessionActions>,
): PlayerSessionController {
  return {
    ...refs,
    applyRoomClock: (player, syncState, driftThresholdSec) =>
      actionsRef.current.applyRoomClock(player, syncState, driftThresholdSec),
    enforceServerPlaybackState: () =>
      actionsRef.current.enforceServerPlaybackState(),
    getCurrentTimeMs: () => actionsRef.current.getCurrentTimeMs(),
    commitLiveEdgeSeek: () => actionsRef.current.commitLiveEdgeSeek(),
    selectPlaylistIndex: (index) =>
      actionsRef.current.selectPlaylistIndex(index),
    beginSeek: (targetMs) => actionsRef.current.beginSeek(targetMs),
    updateSeek: (targetMs) => actionsRef.current.updateSeek(targetMs),
    commitSeek: (targetMs) => actionsRef.current.commitSeek(targetMs),
    setIsBuffering: (value) => actionsRef.current.setIsBuffering(value),
    setPlaybackError: (value) => actionsRef.current.setPlaybackError(value),
    setMediaDurationMs: (value) => actionsRef.current.setMediaDurationMs(value),
    setForceLocalRelaySrc: (value) =>
      actionsRef.current.setForceLocalRelaySrc(value),
    setPlayerRemountNonce: (updater) =>
      actionsRef.current.setPlayerRemountNonce(updater),
    unmute: () => actionsRef.current.unmute(),
    handleVolumeChange: (detail) =>
      actionsRef.current.handleVolumeChange(detail),
  }
}

/**
 * Publish the latest action implementations without mutating controller method
 * identity. Safe to call during render (same pattern as useLatestRef).
 */
export function syncPlayerSessionActions(
  actionsRef: MutableRefObject<PlayerSessionActions>,
  actions: PlayerSessionActions,
): void {
  actionsRef.current = actions
}
