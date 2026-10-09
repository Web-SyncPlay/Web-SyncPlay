import {
  pendingSyncFromPlayback,
} from "./use-buffering-watchdog"
import { SEEK_ACK_MATCH_THRESHOLD_MS } from "../playback-control/use-playback-timeline-controller"
import type { SyncedMediaPlayerHandlerDeps } from "./synced-media-player-handler-types"

type PlaybackLifecycleDeps = Pick<
  SyncedMediaPlayerHandlerDeps,
  | "playerRef"
  | "current"
  | "canControlPlayback"
  | "isMuted"
  | "preferredVolume"
  | "playbackRef"
  | "isMediaReadyRef"
  | "bufferingSinceRef"
  | "participantStatusErrorRef"
  | "pendingSyncRef"
  | "reportedItemErrorRef"
  | "awaitingSeekTargetMs"
  | "send"
  | "applyRoomClock"
  | "enforceServerPlaybackState"
  | "setIsBuffering"
  | "setPlaybackError"
>

/** Element lifecycle handlers (ready, buffering, play/pause events). */
export function createPlaybackLifecycleHandlers(deps: PlaybackLifecycleDeps) {
  const {
    playerRef,
    current,
    canControlPlayback,
    isMuted,
    preferredVolume,
    playbackRef,
    isMediaReadyRef,
    bufferingSinceRef,
    participantStatusErrorRef,
    pendingSyncRef,
    reportedItemErrorRef,
    awaitingSeekTargetMs,
    send,
    applyRoomClock,
    enforceServerPlaybackState,
    setIsBuffering,
    setPlaybackError,
  } = deps

  return {
    onPlay: () => {
      setIsBuffering(false)
      setPlaybackError(undefined)
      participantStatusErrorRef.current = null
      bufferingSinceRef.current = null
      if (!canControlPlayback && playbackRef.current.paused) {
        enforceServerPlaybackState()
      }
    },
    onPause: () => {
      setIsBuffering(false)
      bufferingSinceRef.current = null
      // Unexpected provider pauses must not stick while room says playing.
      // User gestures are preventDefault'd above, so this only recovers
      // provider drift — not a controller click that already sent pause.
      if (!playbackRef.current.paused) {
        enforceServerPlaybackState()
      }
    },
    onPlaying: () => {
      setIsBuffering(false)
      setPlaybackError(undefined)
      participantStatusErrorRef.current = null
      bufferingSinceRef.current = null
      if (
        current &&
        canControlPlayback &&
        (current.ingestStatus === "error" || Boolean(current.ingestError))
      ) {
        reportedItemErrorRef.current = null
        send("playlist:item:error", {
          itemId: current.id,
          error: null,
        })
      }
    },
    onWaiting: () => {
      setIsBuffering(true)
      if (bufferingSinceRef.current === null) {
        bufferingSinceRef.current = Date.now()
      }
    },
    onLoadStart: () => {
      isMediaReadyRef.current = false
      setIsBuffering(true)
      bufferingSinceRef.current = Date.now()
    },
    onCanPlay: () => {
      isMediaReadyRef.current = true
      setIsBuffering(false)
      participantStatusErrorRef.current = null
      bufferingSinceRef.current = null
      const player = playerRef.current
      if (!player) {
        return
      }

      const pending =
        pendingSyncRef.current ??
        pendingSyncFromPlayback(playbackRef.current)

      const pendingToApply =
        awaitingSeekTargetMs !== null &&
        Math.abs(pending.timelineAnchorMs - awaitingSeekTargetMs) >=
          SEEK_ACK_MATCH_THRESHOLD_MS
          ? {
              ...pending,
              paused: Boolean(player.paused),
              timelineAnchorMs: awaitingSeekTargetMs,
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
    },
  }
}
