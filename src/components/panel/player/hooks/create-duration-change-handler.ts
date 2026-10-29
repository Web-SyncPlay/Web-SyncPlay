import { looksLikeBufferOnlyBound } from "@/client/player/playback-sync"
import { readPlayerSeekableEndSec } from "@/shared/dom/player-utils"
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
  | "playerRef"
>

export function createDurationChangeHandler(deps: DurationChangeDeps) {
  const {
    current,
    activePlaybackSrc,
    enforceServerPlaybackState,
    send,
    reportedDurationItemIdRef,
    setMediaDurationMs,
    playerRef,
  } = deps

  return {
    onDurationChange: (detail: unknown) => {
      const durationSec = Number(detail)
      if (!Number.isFinite(durationSec) || durationSec <= 0) {
        setMediaDurationMs(0)
        return
      }

      const seekableEndSec = readPlayerSeekableEndSec(playerRef.current ?? {})
      const finiteSeekable =
        seekableEndSec != null &&
        Number.isFinite(seekableEndSec) &&
        seekableEndSec > 0
          ? seekableEndSec
          : null
      const bufferSized = looksLikeBufferOnlyBound(durationSec, finiteSeekable)
      const nextMs = Math.floor(durationSec * 1000)

      // Upward-only local duration: reject buffer-sized first samples and never
      // shrink toward a short blip once a larger trusted value exists.
      setMediaDurationMs((prev) => {
        const prevMs = Number(prev)
        const prevOk = Number.isFinite(prevMs) && prevMs > 0 ? prevMs : 0
        if (bufferSized && (prevOk <= 0 || nextMs <= prevOk)) {
          return prevOk
        }
        if (prevOk > 0 && nextMs < prevOk) {
          return prevOk
        }
        return nextMs
      })

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
      // Do not poison the catalog with a buffer-sized first paint sample.
      if (bufferSized) {
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
