import {
  computeExpectedPlaybackTimeSec,
  getAdjacentPlaylistIndex,
} from "@/client/player/playback-sync"
import { serverNowEstimateMs } from "@/shared/server-clock"

import type { SyncedMediaPlayerHandlerDeps } from "./synced-media-player-handler-types"

type EndedHandlerDeps = Pick<
  SyncedMediaPlayerHandlerDeps,
  | "canControlPlayback"
  | "enforceServerPlaybackState"
  | "playbackRef"
  | "playlistNavRef"
  | "totalItems"
  | "send"
  | "getCurrentTimeMs"
  | "selectPlaylistIndex"
  | "current"
  | "playerRef"
>

/** Keep pause just before true EOF so providers don't treat the seek as restart. */
const EOF_PAUSE_EPSILON_SEC = 0.05

/**
 * YouTube (and some iframe providers) reset currentTime to 0 on ENDED.
 * Never publish that zero as the room pause anchor when duration / room
 * clock still say we were near EOF.
 */
export function resolveEndedPauseCurrentTimeMs(deps: {
  getCurrentTimeMs: () => number
  playbackRef: EndedHandlerDeps["playbackRef"]
  current: EndedHandlerDeps["current"]
  playerRef: EndedHandlerDeps["playerRef"]
  nowMs?: number
}): number {
  const playheadMs = Math.max(
    0,
    Math.floor(Number(deps.getCurrentTimeMs()) || 0),
  )

  const catalogSec = Number(deps.current?.durationSeconds)
  const playerDuration = Number(deps.playerRef.current?.duration)
  const durationSec = [catalogSec, playerDuration].find(
    (sec) => Number.isFinite(sec) && sec > 0,
  )

  const eofMs =
    durationSec !== undefined
      ? Math.max(0, Math.floor((durationSec - EOF_PAUSE_EPSILON_SEC) * 1000))
      : 0

  const playback = deps.playbackRef.current
  const roomProjectedMs = Math.max(
    0,
    Math.floor(
      computeExpectedPlaybackTimeSec(
        playback,
        deps.nowMs ?? serverNowEstimateMs(),
      ) * 1000,
    ),
  )

  // Prefer the strongest EOF signal, but never publish past known duration
  // (room clock can drift slightly past EOF and thrash pause/seek).
  const raw = Math.max(playheadMs, eofMs, roomProjectedMs)
  return eofMs > 0 ? Math.min(raw, eofMs) : raw
}

export function createEndedHandler(deps: EndedHandlerDeps) {
  const {
    canControlPlayback,
    enforceServerPlaybackState,
    playbackRef,
    playlistNavRef,
    totalItems,
    send,
    getCurrentTimeMs,
    selectPlaylistIndex,
    current,
    playerRef,
  } = deps

  return {
    onEnded: () => {
      if (!canControlPlayback) {
        enforceServerPlaybackState()
        return
      }

      // HTML `loop` already restarts when videoLoop is on.
      if (playbackRef.current.videoLoop !== "off") {
        return
      }

      const { currentIndex, playlistLoop } = playlistNavRef.current
      const nextIndex = getAdjacentPlaylistIndex({
        currentIndex,
        totalItems,
        loopMode: playlistLoop,
        direction: "next",
      })
      if (nextIndex === null) {
        // Pause at EOF so declarative autoPlay + sync don't thrash the
        // last few frames while the room is still "playing".
        if (!playbackRef.current.paused) {
          send("playback:pause", {
            currentTimeMs: resolveEndedPauseCurrentTimeMs({
              getCurrentTimeMs,
              playbackRef,
              current,
              playerRef,
            }),
          })
        }
        return
      }

      selectPlaylistIndex(nextIndex)
    },
  }
}
