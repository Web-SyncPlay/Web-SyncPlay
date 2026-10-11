import type { SyncedMediaPlayerHandlerDeps } from "./synced-media-player-handler-types"
import { markTransportIntent } from "./transport-intent"
import { readPlayerLivePlaying } from "./to-syncable-player"

type TransportRequestDeps = Pick<
  SyncedMediaPlayerHandlerDeps,
  | "playerRef"
  | "canControlPlayback"
  | "enforceServerPlaybackState"
  | "clearTransportNudge"
  | "transportIntentRef"
  | "playbackRef"
  | "send"
  | "getCurrentTimeMs"
  | "seekPhase"
  | "beginSeek"
  | "updateSeek"
  | "commitSeek"
  | "commitLiveEdgeSeek"
>

/** Gesture/request handlers that map Vidstack transport to room events. */
export function createTransportRequestHandlers(deps: TransportRequestDeps) {
  const {
    playerRef,
    canControlPlayback,
    enforceServerPlaybackState,
    clearTransportNudge,
    transportIntentRef,
    playbackRef,
    send,
    getCurrentTimeMs,
    seekPhase,
    beginSeek,
    updateSeek,
    commitSeek,
    commitLiveEdgeSeek,
  } = deps

  return {
    onKeyDownCapture: (event: {
      key: string
      preventDefault: () => void
      stopPropagation: () => void
    }) => {
      if (canControlPlayback) {
        return
      }
      const key = event.key.toLowerCase()
      const allowedGuestKeys = new Set(["m", "arrowup", "arrowdown"])
      if (allowedGuestKeys.has(key)) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
    },
    onMediaPlayRequest: (event: { preventDefault: () => void }) => {
      // Room playback owns transport. Never let Vidstack gestures/buttons
      // toggle the element locally — that races with onPause enforce and
      // causes click-pause → brief spinner → resume, then desync.
      event.preventDefault()
      if (!canControlPlayback) {
        enforceServerPlaybackState()
        return
      }
      // User intent: send when the room is paused OR the element is actually
      // paused (room ref can lag/lead the live element).
      const roomPaused = playbackRef.current.paused
      const elementPlaying = readPlayerLivePlaying(playerRef.current)
      if (roomPaused || elementPlaying === false) {
        markTransportIntent(transportIntentRef, false)
        clearTransportNudge()
        send("playback:play", { currentTimeMs: getCurrentTimeMs() })
      }
    },
    onMediaPauseRequest: (event: { preventDefault: () => void }) => {
      event.preventDefault()
      if (!canControlPlayback) {
        enforceServerPlaybackState()
        return
      }
      // User intent: send when the room is unpaused OR the element is
      // actually playing (room ref may already say paused while HLS / local
      // HTTP still plays — skipping the send leaves authority unpaused).
      const roomPaused = playbackRef.current.paused
      const elementPlaying = readPlayerLivePlaying(playerRef.current)
      if (!roomPaused || elementPlaying === true) {
        markTransportIntent(transportIntentRef, true)
        clearTransportNudge()
        send("playback:pause", { currentTimeMs: getCurrentTimeMs() })
      }
    },
    onMediaSeekingRequest: (detail: unknown) => {
      if (!canControlPlayback) {
        enforceServerPlaybackState()
        return
      }
      const targetSec = Number(detail)
      if (!Number.isFinite(targetSec)) {
        commitLiveEdgeSeek()
        return
      }
      const targetMs = Math.max(0, Math.floor(targetSec * 1000))
      if (seekPhase === "idle") {
        beginSeek(targetMs)
        return
      }
      updateSeek(targetMs)
    },
    onMediaSeekRequest: (detail: unknown) => {
      if (!canControlPlayback) {
        enforceServerPlaybackState()
        return
      }
      const targetSec = Number(detail)
      if (!Number.isFinite(targetSec)) {
        commitLiveEdgeSeek()
        return
      }
      commitSeek(Math.max(0, Math.floor(targetSec * 1000)))
    },
    onMediaLiveEdgeRequest: () => {
      if (!canControlPlayback) {
        enforceServerPlaybackState()
        return
      }
      commitLiveEdgeSeek()
    },
    onMediaRateChangeRequest: (detail: unknown) => {
      if (!canControlPlayback) {
        enforceServerPlaybackState()
        return
      }
      const nextRate = Number(detail)
      if (!Number.isFinite(nextRate)) {
        return
      }
      if (Math.abs(nextRate - playbackRef.current.playbackRate) < 0.001) {
        return
      }
      send("playback:rate", { playbackRate: nextRate })
    },
    onMediaUserLoopChangeRequest: (detail: boolean) => {
      if (!canControlPlayback) {
        enforceServerPlaybackState()
        return
      }

      const nextMode = detail ? "always" : "off"
      if (nextMode === playbackRef.current.videoLoop) {
        return
      }

      send("playback:loop:video", { mode: nextMode })
    },
  }
}
