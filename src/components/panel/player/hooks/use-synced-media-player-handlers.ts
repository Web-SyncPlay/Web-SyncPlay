"use client"

import { useMemo } from "react"
import { createDurationChangeHandler } from "./create-duration-change-handler"
import { createEndedHandler } from "./create-ended-handler"
import { createPlaybackErrorHandler } from "./create-playback-error-handler"
import { createPlaybackLifecycleHandlers } from "./create-playback-lifecycle-handlers"
import { createTransportRequestHandlers } from "./create-transport-request-handlers"
import { createVolumeChangeHandler } from "./create-volume-change-handler"
import type { SyncedMediaPlayerHandlerDeps } from "./synced-media-player-handler-types"

export type {
  PlaylistNavSnapshot,
  SyncedMediaPlayerHandlerDeps,
} from "./synced-media-player-handler-types"

/**
 * MediaPlayer event handlers for SyncedMediaPlayer.
 * Memoized so Vidstack does not re-subscribe every render.
 */
export function useSyncedMediaPlayerHandlers(deps: SyncedMediaPlayerHandlerDeps) {
  return useMemo(
    () => ({
      ...createTransportRequestHandlers(deps),
      ...createPlaybackLifecycleHandlers(deps),
      ...createPlaybackErrorHandler(deps),
      ...createVolumeChangeHandler(deps),
      ...createEndedHandler(deps),
      ...createDurationChangeHandler(deps),
    }),
    // Handler factories close over the latest deps object; identity is owned by
    // the session controller / view-model layer (stable across renders).
    [deps],
  )
}

export type SyncedMediaPlayerHandlers = ReturnType<
  typeof useSyncedMediaPlayerHandlers
>
