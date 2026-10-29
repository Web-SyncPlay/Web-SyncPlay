import type { MediaPlayerInstance } from "@vidstack/react"

import {
  readPlayerPlayheadSec,
  type SyncablePlayer,
} from "@/client/player/apply-playback-sync"
import {
  queryPlayerMediaElement,
  readPlayerSeekableEndSec,
} from "@/shared/dom/player-utils"

/**
 * Live "is playing" for **user-intent** transport handlers (OR of element and
 * wrapper). Prefer this when deciding whether a click should send room
 * play/pause — either signal means the user still sees motion or expected it.
 *
 * Sync-engine convergence uses `isSyncablePlayerPlaying` / `toSyncablePlayer`
 * instead (mediaEl-first) so a lying wrapper cannot clear pending play.
 */
function readWrapperPaused(
  player: Pick<MediaPlayerInstance, "paused">,
): boolean | null {
  try {
    return player.paused
  } catch {
    // Vidstack throws ("provider destroyed") while the provider swaps.
    return null
  }
}

/** Safe paused read for heartbeats / lifecycle — never throws on provider swap. */
export function readPlayerPausedSafe(
  player: Pick<MediaPlayerInstance, "paused" | "el"> | null | undefined,
): boolean {
  const live = readPlayerLivePlaying(player)
  if (live === null) {
    return true
  }
  return !live
}

export function readPlayerLivePlaying(
  player: Pick<MediaPlayerInstance, "paused" | "el"> | null | undefined,
): boolean | null {
  if (!player) {
    return null
  }
  let elPaused: boolean | undefined
  try {
    elPaused = queryPlayerMediaElement(player.el)?.paused
  } catch {
    elPaused = undefined
  }
  const wrapperPaused = readWrapperPaused(player)
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
      try {
        return player.playbackRate
      } catch {
        return 1
      }
    },
    set playbackRate(value: number) {
      try {
        player.playbackRate = value
      } catch {
        // Provider may be rebuilding.
      }
    },
    get currentTime() {
      try {
        return player.currentTime
      } catch {
        return 0
      }
    },
    set currentTime(value: number) {
      try {
        player.currentTime = value
      } catch {
        // Provider may be rebuilding.
      }
    },
    // Live getters: buffered duration/seekable grow mid-session; snapshot
    // fields would keep the engine measuring against a stale ~5s window.
    get duration() {
      try {
        const mediaDuration = Number(resolveMediaEl()?.duration)
        if (Number.isFinite(mediaDuration) && mediaDuration > 0) {
          return mediaDuration
        }
        return player.duration
      } catch {
        return Number.NaN
      }
    },
    get seekableEnd() {
      try {
        return readPlayerSeekableEndSec(player)
      } catch {
        return Number.NaN
      }
    },
    // Live getter: blob / relay remounts replace the <video>; a captured
    // reference goes stale and pause/seek nudges hit a detached element.
    get mediaEl() {
      try {
        return resolveMediaEl()
      } catch {
        return null
      }
    },
    // Live read: mediaEl-first (same as `isSyncablePlayerPlaying`). Declarative
    // `paused={roomPaused}` can lie in either direction; the element is the
    // source of truth for HTML5 convergence and pause/play nudges.
    get paused() {
      try {
        const mediaEl = resolveMediaEl()
        if (mediaEl) {
          return mediaEl.paused
        }
        return readWrapperPaused(player) ?? true
      } catch {
        return true
      }
    },
    pause: () => {
      try {
        player.pause()
      } catch {
        // Provider may be rebuilding.
      }
      try {
        const mediaEl = resolveMediaEl()
        if (mediaEl) {
          try {
            mediaEl.pause()
          } catch {
            // Element may be detached during provider swap.
          }
        }
      } catch {
        // Provider host gone.
      }
      // Belt-and-suspenders for local blob→relay remounts: pause every media
      // node under the player host (light DOM), not only the first match.
      try {
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
      } catch {
        // Ignore.
      }
    },
    play: () => {
      let result: void | Promise<void> | undefined
      try {
        result = player.play()
      } catch {
        // Provider may be rebuilding.
      }
      if (result && typeof result.then === "function") {
        // Swallow Vidstack "provider destroyed" (and autoplay) rejections so
        // teardown mid-play does not become an unhandledrejection.
        result = result.catch(() => {})
      }
      try {
        const mediaEl = resolveMediaEl()
        if (mediaEl && mediaEl.paused !== false) {
          try {
            const elPlay = mediaEl.play()
            if (
              result === undefined &&
              elPlay &&
              typeof (elPlay as Promise<void>).then === "function"
            ) {
              return elPlay.catch(() => {})
            }
          } catch {
            // Element may be detached during provider swap.
          }
        }
      } catch {
        // Provider host gone.
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
