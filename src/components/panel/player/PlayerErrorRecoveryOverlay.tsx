"use client"

import { ControlPanel } from "../control/ControlPanel"

export function PlayerErrorRecoveryOverlay(props: {
  currentName: string | undefined
  paused: boolean
  elapsedMs: number
  totalDurationMs: number | null
  controlsDisabled: boolean
  canControl: boolean
  authorizationHint: string
  disabledHint: string | undefined
  onPlay: () => void
  onPause: () => void
  onSelectAdjacent: (direction: "previous" | "next") => void
  onStepBy: (deltaMs: number) => void
  onSeekPreview: (targetMs: number, active: boolean) => void
  onSeekCommit: (targetMs: number) => void
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center p-3">
      <div className="pointer-events-auto w-full max-w-md sm:w-104">
        <ControlPanel
          title="Playback Error Recovery"
          currentName={props.currentName}
          paused={props.paused}
          elapsedMs={props.elapsedMs}
          totalDurationMs={props.totalDurationMs}
          controlsDisabled={props.controlsDisabled}
          canControl={props.canControl}
          authorizationHint={props.authorizationHint}
          disabledHint={props.disabledHint}
          onPlay={props.onPlay}
          onPause={props.onPause}
          onSelectAdjacent={props.onSelectAdjacent}
          onStepBy={props.onStepBy}
          onSeekPreview={props.onSeekPreview}
          onSeekCommit={props.onSeekCommit}
        />
      </div>
    </div>
  )
}
