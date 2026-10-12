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
 * Live "is playing" for **user-intent** transport handlers (OR of element and
 * wrapper). Prefer this when deciding whether a click should send room
 * play/pause — either signal means the user still sees motion or expected it.
 *
 * Sync-engine convergence uses `isSyncablePlayerPlaying` / `toSyncablePlayer`
 * instead (mediaEl-first) so a lying wrapper cannot clear pending play.
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
  const resolveMediaEl = () =>
    options?.native ? null : queryPlayerMediaElement(player.el)
  return {
    // Live getter/setter: imperative catch-up rate writes must reach Vidstack
    // (a snapshot number would leave declarative `playbackRate={…}` fighting).
    get playbackRate() {
      return player.playbackRate
    },
    set playbackRate(value: number) {
      player.playbackRate = value
    },
    get currentTime() {
      return player.currentTime
    },
    set currentTime(value: number) {
      player.currentTime = value
    },
    // Live getters: buffered duration/seekable grow mid-session; snapshot
    // fields would keep the engine measuring against a stale ~5s window.
    get duration() {
      const mediaDuration = Number(resolveMediaEl()?.duration)
      if (Number.isFinite(mediaDuration) && mediaDuration > 0) {
        return mediaDuration
      }
      return player.duration
    },
    get seekableEnd() {
      return readPlayerSeekableEndSec(player)
    },
    // Live getter: blob / relay remounts replace the <video>; a captured
    // reference goes stale and pause/seek nudges hit a detached element.
    get mediaEl() {
      return resolveMediaEl()
    },
    // Live read: mediaEl-first (same as `isSyncablePlayerPlaying`). Declarative
    // `paused={roomPaused}` can lie in either direction; the element is the
    // source of truth for HTML5 convergence and pause/play nudges.
    get paused() {
      const mediaEl = resolveMediaEl()
      if (mediaEl) {
        return mediaEl.paused
      }
      return player.paused
    },
    pause: () => {
      try {
        player.pause()
      } catch {
        // Provider may be rebuilding.
      }
      const mediaEl = resolveMediaEl()
      if (mediaEl) {
        try {
          mediaEl.pause()
        } catch {
          // Element may be detached during provider swap.
        }
      }
      // Belt-and-suspenders for local blob→relay remounts: pause every media
      // node under the player host (light DOM), not only the first match.
      const root = player.el
      if (root && typeof root.querySelectorAll === "function") {
        for (const el of Array.from(root.querySelectorAll("video, audio"))) {
          if (el instanceof HTMLMediaElement && el.paused === false) {
            try {
              el.pause()
            } catch {
              // Ignore.
            }
          }
        }
      }
    },
    play: () => {
      let result: void | Promise<void> | undefined
      try {
        result = player.play()
      } catch {
        // Provider may be rebuilding.
      }
      const mediaEl = resolveMediaEl()
      if (mediaEl && mediaEl.paused !== false) {
        try {
          const elPlay = mediaEl.play()
          if (
            result === undefined &&
            elPlay &&
            typeof (elPlay as Promise<void>).then === "function"
          ) {
            return elPlay
          }
        } catch {
          // Element may be detached during provider swap.
        }
      }
      return result
    },
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
