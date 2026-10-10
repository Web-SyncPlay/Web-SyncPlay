"use client"

import type { MediaPlayerInstance } from "@vidstack/react"
import { useRef, type MutableRefObject } from "react"
import { useLatestRef } from "@/hooks/use-latest-ref"
import type { RoomState } from "@/contracts/types"
import type { PendingSyncState } from "./use-buffering-watchdog"
import type { PlaylistNavSnapshot } from "./use-synced-media-player-handlers"
import {
  createPlayerSessionActionsRef,
  createPlayerSessionController,
  type PlayerSessionActions,
  type PlayerSessionController,
} from "../player-session-controller"

export type PlayerSessionControllerHandle = {
  controller: PlayerSessionController
  actionsRef: MutableRefObject<PlayerSessionActions>
}

/**
 * Owns player session refs behind a stable PlayerSessionController identity so
 * presence churn cannot invalidate memo(SyncedMediaPlayer) via ref props.
 * Action method identities are also stable (wrappers over actionsRef).
 */
export function usePlayerSessionController(config: {
  playback: RoomState["playback"]
  playlistNav: PlaylistNavSnapshot
}): PlayerSessionControllerHandle {
  const { playback, playlistNav } = config

  const playerRef = useRef<MediaPlayerInstance>(null)
  const playbackRef = useLatestRef(playback)
  const playlistNavRef = useLatestRef(playlistNav)
  const isMediaReadyRef = useRef(false)
  const bufferingSinceRef = useRef<number | null>(null)
  const participantStatusErrorRef = useRef<string | null>(null)
  const pendingSyncRef = useRef<PendingSyncState | null>(null)
  const reportedItemErrorRef = useRef<string | null>(null)
  const reportedDurationItemIdRef = useRef<string | null>(null)
  const proxyRenewAttemptedRef = useRef<string | null>(null)
  const localBlobFallbackAttemptedRef = useRef<string | null>(null)

  // createPlayerSessionActionsRef returns a ref-shaped bag; seed useRef with its
  // initial actions value so we hold MutableRefObject<PlayerSessionActions>.
  const actionsRef = useRef(createPlayerSessionActionsRef().current)
  const controllerRef = useRef<PlayerSessionController | null>(null)
  // Lazy-once init: controller identity must stay stable; actions go through ref.
  /* eslint-disable react-hooks/refs -- create-once session bag over refs */
  if (controllerRef.current == null) {
    controllerRef.current = createPlayerSessionController(
      {
        playerRef,
        playbackRef,
        playlistNavRef,
        isMediaReadyRef,
        bufferingSinceRef,
        participantStatusErrorRef,
        pendingSyncRef,
        reportedItemErrorRef,
        reportedDurationItemIdRef,
        proxyRenewAttemptedRef,
        localBlobFallbackAttemptedRef,
      },
      actionsRef,
    )
  }

  return {
    controller: controllerRef.current,
    actionsRef,
  }
  /* eslint-enable react-hooks/refs */
}
