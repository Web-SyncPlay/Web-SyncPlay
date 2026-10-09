import type { SyncedMediaPlayerHandlerDeps } from "./synced-media-player-handler-types"

type DurationChangeDeps = Pick<
  SyncedMediaPlayerHandlerDeps,
  | "current"
  | "send"
  | "reportedDurationItemIdRef"
  | "setMediaDurationMs"
>

export function createDurationChangeHandler(deps: DurationChangeDeps) {
  const {
    current,
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
