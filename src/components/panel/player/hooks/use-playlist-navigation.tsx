"use client"

import { getAdjacentPlaylistIndex } from "@/client/player/playback-sync"
import type { TypedRoomEventSender } from "@/contracts/room-events"
import { SkipBack, SkipForward } from "lucide-react"
import { useCallback, useMemo } from "react"
import type { PlayerNavRoomState } from "../playback-control/types"

export function usePlaylistNavigation(config: {
  roomState: PlayerNavRoomState
  send: TypedRoomEventSender
  canControlPlayback: boolean
  enforceServerPlaybackState: () => void
}) {
  const { roomState, send, canControlPlayback, enforceServerPlaybackState } =
    config

  const totalItems = roomState.playlist.length
  const hasPlaylistItems = totalItems > 0
  const canWrapPlaylist = roomState.playback.playlistLoop !== "off"
  const hasPreviousItem =
    hasPlaylistItems && (roomState.currentIndex > 0 || canWrapPlaylist)
  const hasNextItem =
    hasPlaylistItems &&
    (roomState.currentIndex < totalItems - 1 || canWrapPlaylist)

  const selectPlaylistIndex = useCallback(
    (targetIndex: number) => {
      send("playlist:select", { index: targetIndex })
      if (
        roomState.playback.playlistLoop === "once" &&
        targetIndex === 0 &&
        roomState.currentIndex === totalItems - 1
      ) {
        send("playback:loop:playlist", { mode: "off" })
      }
    },
    [roomState.currentIndex, roomState.playback.playlistLoop, send, totalItems],
  )

  const handlePlaylistStep = useCallback(
    (direction: "previous" | "next") => {
      if (!canControlPlayback) {
        enforceServerPlaybackState()
        return
      }

      const nextIndex = getAdjacentPlaylistIndex({
        currentIndex: roomState.currentIndex,
        totalItems,
        loopMode: roomState.playback.playlistLoop,
        direction,
      })
      if (nextIndex === null || nextIndex === roomState.currentIndex) {
        return
      }

      selectPlaylistIndex(nextIndex)
    },
    [
      canControlPlayback,
      enforceServerPlaybackState,
      roomState.currentIndex,
      roomState.playback.playlistLoop,
      selectPlaylistIndex,
      totalItems,
    ],
  )

  const previousButtonSlot = useMemo(
    () =>
      hasPreviousItem ? (
        <button
          type="button"
          className="vds-button vds-seek-button"
          data-media-control="seek-backward-button"
          aria-label="Previous item"
          title="Previous item"
          disabled={!canControlPlayback}
          onClick={() => handlePlaylistStep("previous")}
        >
          <SkipBack className="size-4" />
        </button>
      ) : null,
    [canControlPlayback, handlePlaylistStep, hasPreviousItem],
  )

  const nextButtonSlot = useMemo(
    () =>
      hasNextItem ? (
        <button
          type="button"
          className="vds-button vds-seek-button"
          data-media-control="seek-forward-button"
          aria-label="Next item"
          title="Next item"
          disabled={!canControlPlayback}
          onClick={() => handlePlaylistStep("next")}
        >
          <SkipForward className="size-4" />
        </button>
      ) : null,
    [canControlPlayback, handlePlaylistStep, hasNextItem],
  )

  return {
    totalItems,
    selectPlaylistIndex,
    handlePlaylistStep,
    previousButtonSlot,
    nextButtonSlot,
  }
}
