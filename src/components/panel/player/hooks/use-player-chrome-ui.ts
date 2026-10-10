"use client"

import { useEffect, type Dispatch, type SetStateAction } from "react"
import type { TypedRoomEventSender } from "@/contracts/room-events"
import type { ClientRoomState, PlaylistItem } from "@/contracts/types"
import type { PlayerNavRoomState } from "../playback-control/types"
import type { PlayerSessionController } from "../player-session-controller"
import { useBufferingWatchdog } from "./use-buffering-watchdog"
import { usePlayerVolume } from "./use-player-volume"
import { usePlaylistNavigation } from "./use-playlist-navigation"
import { useRemoteSeekOverlay } from "./use-remote-seek-overlay"

/**
 * Player chrome: volume, remote-seek overlay, buffering watchdog, and playlist
 * nav slots. Playlist deny-path uses the stable controller enforce wrapper so
 * this hook can run before the sync pipeline publishes fresh actions.
 */
export function usePlayerChromeUi(config: {
  controller: PlayerSessionController
  playerRemountNonce: number
  totalDurationMs: number | null
  seekPreview: ClientRoomState["playback"]["seekPreview"]
  remoteSeekerName: string
  userId: string
  current: PlaylistItem | undefined
  activePlaybackSrc: string
  viewType: "audio" | "video"
  isBuffering: boolean
  setIsBuffering: (value: boolean) => void
  setPlayerRemountNonce: Dispatch<SetStateAction<number>>
  roomPlayback: ClientRoomState["playback"]
  navRoomState: PlayerNavRoomState
  send: TypedRoomEventSender
  canControlPlayback: boolean
}) {
  const {
    controller,
    playerRemountNonce,
    totalDurationMs,
    seekPreview,
    remoteSeekerName,
    userId,
    current,
    activePlaybackSrc,
    viewType,
    isBuffering,
    setIsBuffering,
    setPlayerRemountNonce,
    roomPlayback,
    navRoomState,
    send,
    canControlPlayback,
  } = config

  const { preferredVolume, handleVolumeChange, isMuted, unmute } =
    usePlayerVolume()
  useEffect(() => {
    const player = controller.playerRef.current
    if (!player) {
      return
    }
    if (Math.abs(player.volume - preferredVolume) > 0.001) {
      // eslint-disable-next-line react-hooks/immutability -- media element API
      player.volume = preferredVolume
    }
    if (player.muted !== isMuted) {
      // eslint-disable-next-line react-hooks/immutability -- media element API
      player.muted = isMuted
    }
  }, [controller, preferredVolume, isMuted, playerRemountNonce])

  const {
    isOtherUserSeeking,
    remoteSeekerName: overlaySeekerName,
    remoteSeekTargetMs,
    seekProgressPercent,
    totalTimeLabel,
  } = useRemoteSeekOverlay({
    mediaDurationMs: totalDurationMs ?? 0,
    seekPreview,
    remoteSeekerName,
    userId,
  })

  const {
    totalItems,
    selectPlaylistIndex,
    handlePlaylistStep,
    previousButtonSlot,
    nextButtonSlot,
  } = usePlaylistNavigation({
    roomState: navRoomState,
    send,
    canControlPlayback,
    // Stable controller wrapper — latest impl is published via actionsRef.
    enforceServerPlaybackState: controller.enforceServerPlaybackState,
  })

  useBufferingWatchdog({
    currentItem: current ? { id: current.id, name: current.name } : null,
    activePlaybackSrc,
    viewType,
    isBuffering,
    isMediaReadyRef: controller.isMediaReadyRef,
    bufferingSinceRef: controller.bufferingSinceRef,
    participantStatusErrorRef: controller.participantStatusErrorRef,
    pendingSyncRef: controller.pendingSyncRef,
    roomPlayback,
    setIsBuffering,
    setPlayerRemountNonce,
  })

  return {
    preferredVolume,
    handleVolumeChange,
    isMuted,
    unmute,
    isOtherUserSeeking,
    overlaySeekerName,
    remoteSeekTargetMs,
    seekProgressPercent,
    totalTimeLabel,
    totalItems,
    selectPlaylistIndex,
    handlePlaylistStep,
    previousButtonSlot,
    nextButtonSlot,
  }
}
