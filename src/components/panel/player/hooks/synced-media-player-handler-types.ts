import type { TypedRoomEventSender } from "@/contracts/room-events"
import type {
  MediaErrorDetail,
  MediaPlayerInstance,
} from "@vidstack/react"
import type { RefObject } from "react"
import type { LoopMode, PlaylistItem, RoomState } from "@/contracts/types"
import type { PlayerSrcInput } from "../player-src"
import type { PendingSyncState } from "./use-buffering-watchdog"
import type { LocalSeekPhase } from "../playback-control/use-playback-timeline-controller"

/** Playlist nav fields read from a ref so ended logic avoids prop churn. */
export type PlaylistNavSnapshot = {
  currentIndex: number
  playlistLoop: LoopMode
}

export type SyncedMediaPlayerHandlerDeps = {
  playerRef: RefObject<MediaPlayerInstance | null>
  current: PlaylistItem | undefined
  playerSrc: PlayerSrcInput
  activePlaybackSrc: string
  send: TypedRoomEventSender
  canControlPlayback: boolean
  isMuted: boolean
  preferredVolume: number
  unmute: () => number
  handleVolumeChange: (detail: { volume: number; muted: boolean }) => void
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
  userId: string
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
