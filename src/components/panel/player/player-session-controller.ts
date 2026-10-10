import type { TypedRoomEventSender } from "@/contracts/room-events"
import type {
  MediaErrorDetail,
  MediaPlayerInstance,
} from "@vidstack/react"
import type { ReactNode, RefObject } from "react"
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
 * Stable session bag for SyncedMediaPlayer: refs + sync/timeline actions.
 * Identity must stay fixed across presence-only room updates; action fields
 * may be reassigned each render (handlers read through the controller).
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

export function createPlayerSessionController(refs: {
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
}): PlayerSessionController {
  const noop = () => {}
  return {
    ...refs,
    applyRoomClock: noop as PlayerSessionController["applyRoomClock"],
    enforceServerPlaybackState: noop,
    getCurrentTimeMs: () => 0,
    commitLiveEdgeSeek: noop,
    selectPlaylistIndex: noop,
    beginSeek: noop,
    updateSeek: noop,
    commitSeek: noop,
    setIsBuffering: noop,
    setPlaybackError: noop,
    setMediaDurationMs: noop,
    setForceLocalRelaySrc: noop,
    setPlayerRemountNonce: noop,
    unmute: () => 0,
    handleVolumeChange: noop,
  }
}

/** Rebind mutable action slots without changing controller identity. */
export function bindPlayerSessionActions(
  controller: PlayerSessionController,
  actions: Pick<
    PlayerSessionController,
    | "applyRoomClock"
    | "enforceServerPlaybackState"
    | "getCurrentTimeMs"
    | "commitLiveEdgeSeek"
    | "selectPlaylistIndex"
    | "beginSeek"
    | "updateSeek"
    | "commitSeek"
    | "setIsBuffering"
    | "setPlaybackError"
    | "setMediaDurationMs"
    | "setForceLocalRelaySrc"
    | "setPlayerRemountNonce"
    | "unmute"
    | "handleVolumeChange"
    | "localBlobFallbackAttemptedRef"
  >,
): void {
  controller.applyRoomClock = actions.applyRoomClock
  controller.enforceServerPlaybackState = actions.enforceServerPlaybackState
  controller.getCurrentTimeMs = actions.getCurrentTimeMs
  controller.commitLiveEdgeSeek = actions.commitLiveEdgeSeek
  controller.selectPlaylistIndex = actions.selectPlaylistIndex
  controller.beginSeek = actions.beginSeek
  controller.updateSeek = actions.updateSeek
  controller.commitSeek = actions.commitSeek
  controller.setIsBuffering = actions.setIsBuffering
  controller.setPlaybackError = actions.setPlaybackError
  controller.setMediaDurationMs = actions.setMediaDurationMs
  controller.setForceLocalRelaySrc = actions.setForceLocalRelaySrc
  controller.setPlayerRemountNonce = actions.setPlayerRemountNonce
  controller.unmute = actions.unmute
  controller.handleVolumeChange = actions.handleVolumeChange
  controller.localBlobFallbackAttemptedRef =
    actions.localBlobFallbackAttemptedRef
}
