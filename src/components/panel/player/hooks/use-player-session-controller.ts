"use client"

import type { MediaPlayerInstance } from "@vidstack/react"
import { useRef } from "react"
import { useLatestRef } from "@/hooks/use-latest-ref"
import type { RoomState } from "@/contracts/types"
import type { PendingSyncState } from "./use-buffering-watchdog"
import type { PlaylistNavSnapshot } from "./use-synced-media-player-handlers"
import {
  createPlayerSessionController,
  type PlayerSessionController,
} from "../player-session-controller"

/**
 * Owns player session refs behind a stable PlayerSessionController identity so
 * presence churn cannot invalidate memo(SyncedMediaPlayer) via ref props.
 */
export function usePlayerSessionController(config: {
  playback: RoomState["playback"]
  playlistNav: PlaylistNavSnapshot
}): PlayerSessionController {
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
  // Placeholder until media-source hook supplies the real ref.
  const localBlobFallbackAttemptedRef = useRef<string | null>(null)

  const controllerRef = useRef<PlayerSessionController | null>(null)
  // Lazy-once init: controller identity must stay stable; it only stores refs.
  /* eslint-disable react-hooks/refs -- create-once session bag over refs */
  if (controllerRef.current == null) {
    controllerRef.current = createPlayerSessionController({
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
    })
  }

  return controllerRef.current
  /* eslint-enable react-hooks/refs */
}
