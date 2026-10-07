"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { formatClockMs } from "@/lib/time-format"
import { cn } from "@/lib/utils"
import { SkipBack, SkipForward } from "lucide-react"

function getSliderTargetMs(values: number | readonly number[]): number {
  if (Array.isArray(values)) {
    return Math.max(0, Number(values[0] ?? 0))
  }
  return Math.max(0, Number(values))
}

function ControlHints(props: {
  authorizationHint?: string
  disabledHint?: string
}) {
  return (
    <>
      {props.authorizationHint ? (
        <p className="text-xs text-muted-foreground">{props.authorizationHint}</p>
      ) : null}
      {props.disabledHint ? (
        <p className="text-xs text-muted-foreground">{props.disabledHint}</p>
      ) : null}
    </>
  )
}

export function ControlPanel(props: {
  title?: string
  currentName?: string
  paused: boolean
  elapsedMs: number
  totalDurationMs: number
  controlsDisabled: boolean
  canControl: boolean
  authorizationHint?: string
  disabledHint?: string
  variant?: "card" | "bar"
  className?: string
  onPlay: (currentTimeMs: number) => void
  onPause: (currentTimeMs: number) => void
  onSelectAdjacent: (direction: "previous" | "next") => void
  onStepBy: (deltaMs: number) => void
  onSeekPreview: (targetMs: number, active: boolean) => void
  onSeekCommit: (targetMs: number) => void
}) {
  const {
    title,
    currentName,
    paused,
    elapsedMs,
    totalDurationMs,
    controlsDisabled,
    canControl,
    authorizationHint,
    disabledHint,
    variant = "card",
    className,
    onPlay,
    onPause,
    onSelectAdjacent,
    onStepBy,
    onSeekPreview,
    onSeekCommit,
  } = props

  const currentSeek = [Math.min(elapsedMs, Math.max(totalDurationMs, 1))]
  const viewOnlyBadge = !canControl ? (
    <Badge variant={controlsDisabled ? "outline" : "secondary"}>
      View-only
    </Badge>
  ) : null

  const touchButtonClass = "min-h-11 touch-manipulation sm:min-h-8"
  const hints = (
    <ControlHints
      authorizationHint={authorizationHint}
      disabledHint={disabledHint}
    />
  )

  const controls = (
    <>
      <div className="grid grid-cols-5 gap-2">
        <Button
          variant="outline"
          className={touchButtonClass}
          disabled={controlsDisabled}
          aria-label="Previous item"
          onClick={() => onSelectAdjacent("previous")}
        >
          <SkipBack className="size-4" />
        </Button>
        <Button
          className={cn("col-span-3", touchButtonClass)}
          disabled={controlsDisabled}
          onClick={() => {
            if (paused) {
              onPlay(elapsedMs)
              return
            }
            onPause(elapsedMs)
          }}
        >
          {paused ? "Play" : "Pause"}
        </Button>
        <Button
          variant="outline"
          className={touchButtonClass}
          disabled={controlsDisabled}
          aria-label="Next item"
          onClick={() => onSelectAdjacent("next")}
        >
          <SkipForward className="size-4" />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          className={touchButtonClass}
          disabled={controlsDisabled}
          onClick={() => onStepBy(-10_000)}
        >
          -10s
        </Button>
        <Button
          variant="outline"
          className={touchButtonClass}
          disabled={controlsDisabled}
          onClick={() => onStepBy(10_000)}
        >
          +10s
        </Button>
      </div>
      <Slider
        min={0}
        max={Math.max(totalDurationMs, 1)}
        value={currentSeek}
        className="touch-manipulation py-2"
        aria-label="Seek playback position"
        onValueChange={(values) => {
          if (controlsDisabled) {
            return
          }
          const targetMs = getSliderTargetMs(values)
          onSeekPreview(targetMs, true)
        }}
        onValueCommitted={(values) => {
          if (controlsDisabled) {
            return
          }
          const targetMs = getSliderTargetMs(values)
          onSeekPreview(targetMs, false)
          onSeekCommit(targetMs)
        }}
        disabled={controlsDisabled}
      />
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {currentName ?? "No media selected"}
        </span>
        {!title ? viewOnlyBadge : null}
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {formatClockMs(elapsedMs)} / {formatClockMs(totalDurationMs)}
        </span>
      </div>
    </>
  )

  if (variant === "bar") {
    return (
      <Card
        className={cn(
          "sticky bottom-0 z-20 rounded-lg border-t bg-card/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur supports-backdrop-filter:bg-card/90",
          className,
        )}
      >
        <CardContent className="space-y-2 py-3">
          {controls}
          {hints}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={cn("rounded-lg", className)}>
      {title ? (
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{title}</span>
            {viewOnlyBadge}
          </CardTitle>
          {hints}
        </CardHeader>
      ) : null}
      <CardContent className="space-y-3">
        {!title ? hints : null}
        {controls}
      </CardContent>
    </Card>
  )
}
