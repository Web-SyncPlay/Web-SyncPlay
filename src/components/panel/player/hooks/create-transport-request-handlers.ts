import type { SyncedMediaPlayerHandlerDeps } from "./synced-media-player-handler-types"
import { readPlayerLivePlaying } from "./to-syncable-player"
import { markTransportIntent } from "./transport-intent"

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

type Preventable = { preventDefault: () => void }

function asPreventable(value: unknown): Preventable | null {
  if (
    value &&
    typeof value === "object" &&
    typeof (value as Preventable).preventDefault === "function"
  ) {
    return value as Preventable
  }
  return null
}

/**
 * Vidstack React DOM callbacks pass `(detail, event)`. Void requests
 * (`media-pause-request` / `media-play-request`) often have `detail: null`,
 * so the first argument is not the event — calling `preventDefault` on it
 * throws and skips the room send. Also accept nested `.event` / `.nativeEvent`.
 */
export function resolveMediaRequestEvent(
  detailOrEvent: unknown,
  maybeEvent?: Preventable,
): Preventable | null {
  const fromSecond = asPreventable(maybeEvent)
  if (fromSecond) {
    return fromSecond
  }
  const fromFirst = asPreventable(detailOrEvent)
  if (fromFirst) {
    return fromFirst
  }
  if (detailOrEvent && typeof detailOrEvent === "object") {
    const nested = detailOrEvent as {
      event?: unknown
      nativeEvent?: unknown
    }
    return (
      asPreventable(nested.event) ?? asPreventable(nested.nativeEvent) ?? null
    )
  }
  return null
}

/** Prevent local Vidstack transport; never throw if the event shape is odd. */
export function preventMediaRequestDefault(
  detailOrEvent: unknown,
  maybeEvent?: Preventable,
): void {
  try {
    resolveMediaRequestEvent(detailOrEvent, maybeEvent)?.preventDefault()
  } catch {
    // Malformed event — room send still proceeds below.
  }
}

/** Coerce Vidstack seek detail (seconds) from a number or event-shaped value. */
export function coerceSeekTargetSec(detail: unknown): number {
  if (typeof detail === "number") {
    return detail
  }
  if (detail && typeof detail === "object") {
    const nested = (detail as { detail?: unknown }).detail
    if (typeof nested === "number") {
      return nested
    }
  }
  return Number(detail)
}

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
    onMediaPlayRequest: (detailOrEvent: unknown, maybeEvent?: Preventable) => {
      // Room playback owns transport. Never let Vidstack gestures/buttons
      // toggle the element locally — that races with onPause enforce and
      // causes click-pause → brief spinner → resume, then desync.
      preventMediaRequestDefault(detailOrEvent, maybeEvent)
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
    onMediaPauseRequest: (detailOrEvent: unknown, maybeEvent?: Preventable) => {
      preventMediaRequestDefault(detailOrEvent, maybeEvent)
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
      const targetSec = coerceSeekTargetSec(detail)
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
      const targetSec = coerceSeekTargetSec(detail)
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
