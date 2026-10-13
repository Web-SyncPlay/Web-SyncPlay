import { pendingSyncFromPlayback } from "@/client/player/pending-sync"
import { SEEK_ACK_MATCH_THRESHOLD_MS } from "../playback-control/use-playback-timeline-controller"
import type { SyncedMediaPlayerHandlerDeps } from "./synced-media-player-handler-types"
import { readPlayerPausedSafe } from "./to-syncable-player"
import { isTransportIntentInFlight } from "./transport-intent"
import { markVolumeSettling } from "./use-player-volume"

/** Ignore transient play→waiting→playing (Gecko/WebKit) and post-snap seeking. */
export const PLAYBACK_WAITING_GRACE_MS = 400

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
  | "clearTransportNudge"
  | "setIsBuffering"
  | "setPlaybackUnlocked"
  | "setSuppressBufferingUi"
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
    clearTransportNudge,
    setIsBuffering,
    setPlaybackUnlocked,
    setSuppressBufferingUi,
    setPlaybackError,
  } = deps

  let waitingGraceUntilMs = 0
  let suppressBufferingUiTimer: ReturnType<typeof setTimeout> | null = null

  const clearSuppressBufferingUiTimer = () => {
    if (suppressBufferingUiTimer !== null) {
      clearTimeout(suppressBufferingUiTimer)
      suppressBufferingUiTimer = null
    }
  }

  const armWaitingGrace = (nowMs = Date.now()) => {
    waitingGraceUntilMs = nowMs + PLAYBACK_WAITING_GRACE_MS
    setSuppressBufferingUi(true)
    clearSuppressBufferingUiTimer()
    suppressBufferingUiTimer = setTimeout(() => {
      suppressBufferingUiTimer = null
      setSuppressBufferingUi(false)
    }, PLAYBACK_WAITING_GRACE_MS)
  }

  const unlockPlaybackAfterClock = () => {
    markVolumeSettling(isMediaReadyRef)
    isMediaReadyRef.current = true
    setPlaybackUnlocked(true)
  }

  return {
    onPlay: () => {
      setIsBuffering(false)
      setPlaybackError(undefined)
      participantStatusErrorRef.current = null
      bufferingSinceRef.current = null
      armWaitingGrace()
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
      // Firefox/Safari emit a brief waiting between play and playing; the
      // canplay force-snap also waits while seeking. Ignore that blip.
      if (Date.now() < waitingGraceUntilMs) {
        return
      }
      setIsBuffering(true)
      if (bufferingSinceRef.current === null) {
        bufferingSinceRef.current = Date.now()
      }
    },
    onLoadStart: () => {
      isMediaReadyRef.current = false
      setPlaybackUnlocked(false)
      waitingGraceUntilMs = 0
      clearSuppressBufferingUiTimer()
      setSuppressBufferingUi(false)
      setIsBuffering(true)
      bufferingSinceRef.current = Date.now()
    },
    onCanPlay: () => {
      armWaitingGrace()
      setIsBuffering(false)
      participantStatusErrorRef.current = null
      bufferingSinceRef.current = null
      const player = playerRef.current
      if (!player) {
        // Still mark ready so presence/sync are not stuck if the element unmounts.
        unlockPlaybackAfterClock()
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
      // Providers may reset volume on load; re-apply preferred level *before*
      // flipping mediaReady so a synchronous volumechange(1) cannot persist.
      if (Math.abs(player.volume - preferredVolume) > 0.001) {
        player.volume = preferredVolume
      }
      if (player.muted !== isMuted) {
        player.muted = isMuted
      }
      // Force-snap while held paused so autoplay cannot paint-at-0 then seek.
      // Room paused=false would otherwise nudge play() mid-snap.
      applyRoomClock(player, { ...pendingToApply, paused: true }, 0)
      clearTransportNudge()
      pendingSyncRef.current = pendingToApply
      // Unlock after the snap — React paused={roomPaused || !unlocked} then
      // starts playback if the room is playing.
      unlockPlaybackAfterClock()
    },
  }
}
