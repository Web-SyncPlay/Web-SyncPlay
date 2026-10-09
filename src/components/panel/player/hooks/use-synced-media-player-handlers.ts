"use client"

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

/** MediaPlayer event handlers for SyncedMediaPlayer (plain object; React Compiler). */
export function useSyncedMediaPlayerHandlers(deps: SyncedMediaPlayerHandlerDeps) {
  return {
    ...createTransportRequestHandlers(deps),
    ...createPlaybackLifecycleHandlers(deps),
    ...createPlaybackErrorHandler(deps),
    ...createVolumeChangeHandler(deps),
    ...createEndedHandler(deps),
    ...createDurationChangeHandler(deps),
  }
}

export type SyncedMediaPlayerHandlers = ReturnType<
  typeof useSyncedMediaPlayerHandlers
>
