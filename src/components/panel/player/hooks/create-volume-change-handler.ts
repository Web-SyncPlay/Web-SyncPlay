import type { SyncedMediaPlayerHandlerDeps } from "./synced-media-player-handler-types"

type VolumeChangeDeps = Pick<
  SyncedMediaPlayerHandlerDeps,
  "playerRef" | "isMuted" | "unmute" | "handleVolumeChange"
>

export function createVolumeChangeHandler(deps: VolumeChangeDeps) {
  const { playerRef, isMuted, unmute, handleVolumeChange } = deps

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
      handleVolumeChange(detail)
    },
  }
}
