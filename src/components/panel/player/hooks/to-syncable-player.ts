import {
  readPlayerPlayheadSec,
  type SyncablePlayer,
} from "@/client/player/apply-playback-sync"
import {
  queryPlayerMediaElement,
  readPlayerSeekableEndSec,
} from "@/shared/dom/player-utils"
import type { MediaPlayerInstance } from "@vidstack/react"

/**
 * Live "is the element actually playing" read for user-intent checks. Either
 * the media element or the player wrapper reporting `paused === false` counts
 * as playing; `null` when neither exposes a paused flag (unknown).
 */
export function readPlayerLivePlaying(
  player: Pick<MediaPlayerInstance, "paused" | "el"> | null | undefined,
): boolean | null {
  if (!player) {
    return null
  }
  const elPaused = queryPlayerMediaElement(player.el)?.paused
  const wrapperPaused = player.paused
  if (elPaused === false || wrapperPaused === false) {
    return true
  }
  if (elPaused === true || wrapperPaused === true) {
    return false
  }
  return null
}

/**
 * Adapt a Vidstack player instance for the pure PlaybackSyncEngine.
 *
 * `native` (YouTube / Vimeo iframe): there is no real media element for the
 * embed — `queryPlayerMediaElement` can fall back to an unrelated `<video>` on
 * the page — so the provider time on the player instance is the only playhead.
 */
export function toSyncablePlayer(
  player: MediaPlayerInstance,
  options?: { native?: boolean },
): SyncablePlayer {
  const mediaEl = options?.native ? null : queryPlayerMediaElement(player.el)
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
    // Live read: retry timers must see the current transport state.
    get paused() {
      return player.paused
    },
    pause: () => player.pause(),
    play: () => player.play(),
  }
}

/**
 * Single playhead read shared by sync engine and presence heartbeat
 * (media element for HLS/direct, provider time for native iframes).
 */
export function readSyncPlayheadSec(
  player: MediaPlayerInstance,
  options?: { native?: boolean },
): number {
  return readPlayerPlayheadSec(toSyncablePlayer(player, options))
}
