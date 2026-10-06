"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import { SkipBack, SkipForward } from "lucide-react"

function formatTime(ms: number) {
  const safe = Math.max(0, Math.floor(ms / 1000))
  const mins = Math.floor(safe / 60)
  const secs = String(safe % 60).padStart(2, "0")
  return `${mins}:${secs}`
}

function getSliderTargetMs(values: number | readonly number[]): number {
  if (Array.isArray(values)) {
    return Math.max(0, Number(values[0] ?? 0))
  }
  return Math.max(0, Number(values))
}

export function ControlPanel(props: {
  title: string
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

  const controls = (
    <>
      <div className="grid grid-cols-5 gap-2">
        <Button
          variant="outline"
          className={touchButtonClass}
          disabled={controlsDisabled}
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
      <div className="text-xs text-muted-foreground">
        {formatTime(elapsedMs)} / {formatTime(totalDurationMs)}
      </div>
    </>
  )

  if (variant === "bar") {
    return (
      <Card
        className={cn(
          "sticky bottom-0 z-20 border-t bg-card/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur supports-backdrop-filter:bg-card/90",
          className,
        )}
      >
        <CardContent className="space-y-2 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="truncate font-medium">
              {currentName ?? "No media selected"}
            </span>
            {viewOnlyBadge}
          </div>
          {controls}
          {authorizationHint ? (
            <p className="text-xs text-muted-foreground">{authorizationHint}</p>
          ) : null}
          {disabledHint ? (
            <p className="text-xs text-muted-foreground">{disabledHint}</p>
          ) : null}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{title}</span>
          {viewOnlyBadge}
        </CardTitle>
        {authorizationHint ? (
          <p className="text-xs text-muted-foreground">{authorizationHint}</p>
        ) : null}
        {disabledHint ? (
          <p className="text-xs text-muted-foreground">{disabledHint}</p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="font-medium">{currentName ?? "No media selected"}</p>
        {controls}
      </CardContent>
    </Card>
  )
}
