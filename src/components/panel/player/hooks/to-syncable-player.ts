import type { SyncablePlayer } from "@/client/player/apply-playback-sync"
import {
  queryPlayerMediaElement,
  readPlayerSeekableEndSec,
} from "@/shared/player-utils"
import type { MediaPlayerInstance } from "@vidstack/react"

/** Adapt a Vidstack player instance for the pure PlaybackSyncEngine. */
export function toSyncablePlayer(player: MediaPlayerInstance): SyncablePlayer {
  const mediaEl = queryPlayerMediaElement(player.el)
  const seekableEndSec = readPlayerSeekableEndSec(player)
  return {
    playbackRate: player.playbackRate,
    get currentTime() {
      return player.currentTime
    },
    set currentTime(value: number) {
      player.currentTime = value
    },
    duration: player.duration,
    seekableEnd: seekableEndSec,
    mediaEl,
    paused: player.paused,
    pause: () => player.pause(),
    play: () => player.play(),
  }
}
