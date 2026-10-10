"use client"

import type { MediaPlayerInstance } from "@vidstack/react"
import { useRef, type RefObject } from "react"
import { useLatestRef } from "@/hooks/use-latest-ref"
import type { TypedRoomEventSender } from "@/contracts/room-events"
import type { ClientRoomState, PlaylistItem } from "@/contracts/types"
import type { PendingSyncState } from "./use-buffering-watchdog"
import { usePlayerPlaybackSync } from "./use-player-playback-sync"

/**
 * Playback sync / engine wiring. Owns session-local clock apply refs and
 * delegates the rest to {@link usePlayerPlaybackSync}.
 */
export function usePlayerSyncPipeline(config: {
  playerRef: RefObject<MediaPlayerInstance | null>
  isMediaReadyRef: RefObject<boolean>
  bufferingSinceRef: RefObject<number | null>
  participantStatusErrorRef: RefObject<string | null>
  pendingSyncRef: RefObject<PendingSyncState | null>
  playbackRef: RefObject<ClientRoomState["playback"]>
  playbackPaused: boolean
  reportedItemErrorRef: RefObject<string | null>
  proxyRenewAttemptedRef: RefObject<string | null>
  current: PlaylistItem | undefined
  activePlaybackSrc: string
  viewType: "audio" | "video"
  playerSrc: unknown
  playback: ClientRoomState["playback"]
  currentIndex: number
  ownerConnected: boolean
  send: TypedRoomEventSender
  canControlPlayback: boolean
  isBuffering: boolean
  playbackErrorLabel: string | undefined
  awaitingSeekTargetMs: number | null
  seekPhase: string
  timelineAnchorMs: number
  commitSeek: (targetMs: number) => void
}) {
  const lastAppliedTimelineAnchorMsRef = useRef<number | null>(null)
  const playbackPausedRef = useLatestRef(config.playbackPaused)

  return usePlayerPlaybackSync({
    playerRef: config.playerRef,
    isMediaReadyRef: config.isMediaReadyRef,
    bufferingSinceRef: config.bufferingSinceRef,
    participantStatusErrorRef: config.participantStatusErrorRef,
    pendingSyncRef: config.pendingSyncRef,
    lastAppliedTimelineAnchorMsRef,
    playbackRef: config.playbackRef,
    playbackPausedRef,
    reportedItemErrorRef: config.reportedItemErrorRef,
    proxyRenewAttemptedRef: config.proxyRenewAttemptedRef,
    current: config.current,
    activePlaybackSrc: config.activePlaybackSrc,
    viewType: config.viewType,
    playerSrc: config.playerSrc,
    playback: config.playback,
    currentIndex: config.currentIndex,
    ownerConnected: config.ownerConnected,
    send: config.send,
    canControlPlayback: config.canControlPlayback,
    isBuffering: config.isBuffering,
    playbackErrorLabel: config.playbackErrorLabel,
    awaitingSeekTargetMs: config.awaitingSeekTargetMs,
    seekPhase: config.seekPhase,
    timelineAnchorMs: config.timelineAnchorMs,
    commitSeek: config.commitSeek,
  })
}
