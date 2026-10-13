import type { SyncedMediaPlayerHandlerDeps } from "./synced-media-player-handler-types"
import { shouldPersistVolumeChange } from "./use-player-volume"

type VolumeChangeDeps = Pick<
  SyncedMediaPlayerHandlerDeps,
  | "playerRef"
  | "isMuted"
  | "preferredVolume"
  | "unmute"
  | "handleVolumeChange"
  | "isMediaReadyRef"
>

export function createVolumeChangeHandler(deps: VolumeChangeDeps) {
  const {
    playerRef,
    isMuted,
    preferredVolume,
    unmute,
    handleVolumeChange,
    isMediaReadyRef,
  } = deps

  return {
    onVolumeChange: (detail: { volume: number; muted: boolean }) => {
      // Native mute toggle: restore preferred volume so unmute is never 100% by default.
      if (!detail.muted && isMuted) {
        const player = playerRef.current
        const volume = unmute()
        if (player) {
          player.volume = volume
          player.muted = false
        }
        return
      }

      const mediaReady = isMediaReadyRef.current
      // Provider/HTML default is volume=1 and props are queued until canplay.
      // Re-assert preference so the UI does not stick at 100% across source changes.
      if (
        !shouldPersistVolumeChange({
          nextVolume: detail.volume,
          nextMuted: detail.muted,
          preferredVolume,
          mediaReady,
        })
      ) {
        const player = playerRef.current
        if (player && Math.abs(player.volume - preferredVolume) > 0.001) {
          player.volume = preferredVolume
        }
      }

      handleVolumeChange({ ...detail, mediaReady })
    },
  }
}
