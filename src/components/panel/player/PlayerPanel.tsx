"use client"

import "@vidstack/react/player/styles/default/layouts/audio.css"
import "@vidstack/react/player/styles/default/layouts/video.css"
import "@vidstack/react/player/styles/default/theme.css"
import { memo } from "react"
import { cn } from "@/components/lib/utils"
import type { TypedRoomEventSender } from "@/contracts/room-events"
import type { RoomPanelProps } from "../../layout/page/types"
import { usePlayerSession } from "./hooks/use-player-session"
import { bindSeekPreview } from "./playback-control/bind-seek-preview"
import { PlayerEmptyState } from "./PlayerEmptyState"
import { PlayerErrorRecoveryOverlay } from "./PlayerErrorRecoveryOverlay"
import { PlayerPanelGlobalStyles } from "./PlayerPanelGlobalStyles"
import { RemoteSeekOverlay } from "./RemoteSeekOverlay"
import { SyncedMediaPlayer } from "./SyncedMediaPlayer"
import { TapToUnmuteButton } from "./TapToUnmuteButton"
import {
  playerShellSlicesEqual,
  selectPlayerShellSlice,
  type PlayerShellSlice,
} from "./player-room-selectors"

type PlayerPanelShellProps = {
  slice: PlayerShellSlice
  roomId: string
  userId: string
  send: TypedRoomEventSender
  capabilities: RoomPanelProps["capabilities"]
  className?: string
}

/**
 * Presence-sensitive outer shell: derives a narrow slice so the memoized
 * body does not re-render on participants/lastSeen churn.
 */
export function PlayerPanel({
  roomState,
  roomId,
  send,
  userId,
  capabilities,
  className,
}: RoomPanelProps & { className?: string }) {
  const slice = selectPlayerShellSlice(roomState, userId)
  return (
    <PlayerPanelShell
      slice={slice}
      roomId={roomId}
      userId={userId}
      send={send}
      capabilities={capabilities}
      className={className}
    />
  )
}

const PlayerPanelShell = memo(
  function PlayerPanelShell({
    slice,
    roomId,
    send,
    userId,
    capabilities,
    className,
  }: PlayerPanelShellProps) {
    const session = usePlayerSession({
      slice,
      userId,
      send,
      capabilities,
    })
    const {
      controller,
      viewModel,
      canControlPlayback,
      controlsDisabled,
      isMuted,
      unmute,
      activePlaybackSrc,
      isOtherUserSeeking,
      overlaySeekerName,
      seekProgressPercent,
      remoteSeekTargetMs,
      totalTimeLabel,
      playbackErrorLabel,
      elapsedMs,
      totalDurationMs,
      playbackPaused,
      currentName,
      handlePlaylistStep,
      timeline,
    } = session

    return (
      <div
        className={cn(
          "relative aspect-video size-full overflow-hidden rounded-lg bg-black",
          className,
        )}
      >
        {!canControlPlayback && (
          <div className="guest-view-hint pointer-events-none absolute left-3 top-3 z-20 rounded-md bg-black/70 px-2 py-1 text-xs text-white/90">
            Guest view — use player settings for tracks, captions, quality &
            audio delay
          </div>
        )}
        {isMuted && Boolean(activePlaybackSrc) && (
          <TapToUnmuteButton
            playerRef={controller.playerRef}
            unmute={unmute}
          />
        )}
        {activePlaybackSrc ? (
          <SyncedMediaPlayer controller={controller} viewModel={viewModel} />
        ) : (
          <PlayerEmptyState
            send={send}
            canControlPlayback={canControlPlayback}
            roomId={roomId}
            userId={userId}
          />
        )}
        {isOtherUserSeeking && (
          <RemoteSeekOverlay
            remoteSeekerName={overlaySeekerName}
            seekProgressPercent={seekProgressPercent}
            remoteSeekTargetMs={remoteSeekTargetMs}
            totalTimeLabel={totalTimeLabel}
          />
        )}
        {playbackErrorLabel && (
          <PlayerErrorRecoveryOverlay
            currentName={currentName}
            paused={playbackPaused}
            elapsedMs={elapsedMs}
            totalDurationMs={totalDurationMs}
            controlsDisabled={controlsDisabled}
            canControl={canControlPlayback}
            authorizationHint={playbackErrorLabel}
            disabledHint={
              isOtherUserSeeking
                ? `${overlaySeekerName} is seeking: controls are temporarily disabled.`
                : undefined
            }
            onPlay={timeline.play}
            onPause={timeline.pause}
            onSelectAdjacent={handlePlaylistStep}
            onStepBy={timeline.stepBy}
            onSeekPreview={bindSeekPreview(timeline)}
            onSeekCommit={timeline.commitSeek}
          />
        )}
        <PlayerPanelGlobalStyles />
      </div>
    )
  },
  (prev, next) =>
    prev.roomId === next.roomId &&
    prev.userId === next.userId &&
    prev.send === next.send &&
    prev.capabilities === next.capabilities &&
    prev.className === next.className &&
    playerShellSlicesEqual(prev.slice, next.slice),
)
