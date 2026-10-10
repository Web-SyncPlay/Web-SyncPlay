import { getAdjacentPlaylistIndex } from "@/client/player/playback-sync"
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
>

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
            currentTimeMs: getCurrentTimeMs(),
          })
        }
        return
      }

      selectPlaylistIndex(nextIndex)
    },
  }
}
