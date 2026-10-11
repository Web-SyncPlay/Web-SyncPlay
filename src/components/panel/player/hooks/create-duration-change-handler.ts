import { isNativeProviderUrl } from "@/shared/player-utils"
import type { SyncedMediaPlayerHandlerDeps } from "./synced-media-player-handler-types"

type DurationChangeDeps = Pick<
  SyncedMediaPlayerHandlerDeps,
  | "current"
  | "activePlaybackSrc"
  | "enforceServerPlaybackState"
  | "send"
  | "reportedDurationItemIdRef"
  | "setMediaDurationMs"
>

export function createDurationChangeHandler(deps: DurationChangeDeps) {
  const {
    current,
    activePlaybackSrc,
    enforceServerPlaybackState,
    send,
    reportedDurationItemIdRef,
    setMediaDurationMs,
  } = deps

  return {
    onDurationChange: (detail: unknown) => {
      const durationSec = Number(detail)
      if (!Number.isFinite(durationSec) || durationSec <= 0) {
        setMediaDurationMs(0)
        return
      }

      setMediaDurationMs(Math.floor(durationSec * 1000))

      // Native iframe sync is gated until duration is known (seeks no-op
      // before boot). Re-apply the room clock now that it has arrived; the
      // engine only force-snaps if it actually deferred a seek.
      if (isNativeProviderUrl(activePlaybackSrc)) {
        enforceServerPlaybackState()
      }

      // Fill room catalog so headless control pages get a finite duration.
      const item = current
      if (!item || item.isLive === true) {
        return
      }
      const catalogSec = Number(item.durationSeconds)
      if (Number.isFinite(catalogSec) && catalogSec > 0) {
        return
      }
      if (reportedDurationItemIdRef.current === item.id) {
        return
      }
      reportedDurationItemIdRef.current = item.id
      send("playlist:item:duration", {
        itemId: item.id,
        durationSeconds: Math.round(durationSec),
      })
    },
  }
}
