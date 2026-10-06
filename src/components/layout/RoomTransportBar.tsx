"use client"

import { ControlPanel } from "@/components/panel/control/ControlPanel"
import { getPlaybackPermissionsState } from "@/components/panel/player/playback-control/use-playback-permissions-state"
import { usePlaybackTimelineController } from "@/components/panel/player/playback-control/use-playback-timeline-controller"
import type { RoomPanelProps } from "./page/types"

export function RoomTransportBar({
  roomState,
  send,
  userId,
  capabilities,
}: RoomPanelProps) {
  const canControlBySession =
    !capabilities.isControlSession || capabilities.controlAuthorized
  const {
    canControl,
    controlsDisabled,
    disabledHint,
    authorizationHint,
  } = getPlaybackPermissionsState({
    roomState,
    userId,
    canControlBySession,
  })
  const current = roomState.playlist[roomState.currentIndex]
  const timeline = usePlaybackTimelineController({
    roomState,
    send,
    controlsDisabled,
  })
  const totalDurationMs = Math.floor((current?.durationSeconds ?? 0) * 1000)

  return (
    <ControlPanel
      title="Transport"
      variant="bar"
      currentName={current?.name}
      paused={roomState.playback.paused}
      elapsedMs={timeline.elapsedMs}
      totalDurationMs={totalDurationMs}
      controlsDisabled={controlsDisabled}
      canControl={canControl}
      authorizationHint={authorizationHint}
      disabledHint={disabledHint}
      onPlay={timeline.play}
      onPause={timeline.pause}
      onSelectAdjacent={timeline.selectAdjacent}
      onStepBy={timeline.stepBy}
      onSeekPreview={(targetMs, active) => {
        if (active) {
          if (timeline.seekPhase === "idle") {
            timeline.beginSeek(targetMs)
            return
          }
          timeline.updateSeek(targetMs)
          return
        }
        timeline.endSeekPreview(targetMs)
      }}
      onSeekCommit={timeline.commitSeek}
    />
  )
}
