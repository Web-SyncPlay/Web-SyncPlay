import { pendingSyncFromPlayback } from "@/client/player/pending-sync"
import { SEEK_ACK_MATCH_THRESHOLD_MS } from "../playback-control/use-playback-timeline-controller"
import type { SyncedMediaPlayerHandlerDeps } from "./synced-media-player-handler-types"
import { readPlayerPausedSafe } from "./to-syncable-player"
import { isTransportIntentInFlight } from "./transport-intent"
import { markVolumeSettling } from "./use-player-volume"

type PlaybackLifecycleDeps = Pick<
  SyncedMediaPlayerHandlerDeps,
  | "playerRef"
  | "current"
  | "canControlPlayback"
  | "isMuted"
  | "preferredVolume"
  | "playbackRef"
  | "transportIntentRef"
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
    transportIntentRef,
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
      // A controller pause click whose authority has not landed yet is user
      // intent — enforcing now would resume playback and fight the pause.
      const roomPaused = playbackRef.current.paused
      if (
        !roomPaused &&
        !isTransportIntentInFlight(transportIntentRef, true, roomPaused)
      ) {
        enforceServerPlaybackState()
      }
    },
    onPlaying: () => {
      setIsBuffering(false)
      setPlaybackError(undefined)
      participantStatusErrorRef.current = null
      bufferingSinceRef.current = null
      // HLS/local HTTP can emit `playing` after an authority pause (late
      // resume). Re-assert pause through the engine so pending pause survives.
      const roomPaused = playbackRef.current.paused
      if (
        roomPaused &&
        !isTransportIntentInFlight(transportIntentRef, false, roomPaused)
      ) {
        enforceServerPlaybackState()
      }
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
      setIsBuffering(false)
      participantStatusErrorRef.current = null
      bufferingSinceRef.current = null
      const player = playerRef.current
      if (!player) {
        // Still mark ready so presence/sync are not stuck if the element unmounts.
        markVolumeSettling(isMediaReadyRef)
        isMediaReadyRef.current = true
        return
      }

      const pending =
        pendingSyncRef.current ?? pendingSyncFromPlayback(playbackRef.current)

      const pendingToApply =
        awaitingSeekTargetMs !== null &&
        Math.abs(pending.timelineAnchorMs - awaitingSeekTargetMs) >=
          SEEK_ACK_MATCH_THRESHOLD_MS
          ? {
              ...pending,
              paused: readPlayerPausedSafe(player),
              timelineAnchorMs: awaitingSeekTargetMs,
              serverNowMs: Date.now(),
            }
          : pending
      // Force-snap after canplay — HLS often becomes seekable only here.
      applyRoomClock(player, pendingToApply, 0)
      // Providers may reset volume on load; re-apply preferred level *before*
      // flipping mediaReady so a synchronous volumechange(1) cannot persist.
      if (Math.abs(player.volume - preferredVolume) > 0.001) {
        player.volume = preferredVolume
      }
      if (player.muted !== isMuted) {
        player.muted = isMuted
      }
      markVolumeSettling(isMediaReadyRef)
      isMediaReadyRef.current = true
    },
  }
}
