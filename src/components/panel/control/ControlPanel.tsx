"use client"

import { cn } from "@/components/lib/utils"
import { SeekScrubber } from "@/components/panel/control/SeekScrubber"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SkipBack, SkipForward } from "lucide-react"

function ControlHints(props: {
  authorizationHint?: string
  disabledHint?: string
}) {
  return (
    <>
      {props.authorizationHint ? (
        <p className="text-xs text-muted-foreground">
          {props.authorizationHint}
        </p>
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
  /** `null` when catalog/player duration is unknown — never treat as 0. */
  totalDurationMs: number | null
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

  // < lg: 3-row cluster (prev/next, play, ±10s). lg+: one 5-button row
  // (prev, play, next, -10s, +10s) sharing the scrubber line.
  const transport = (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
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
        variant="outline"
        className={cn(touchButtonClass, "lg:order-3")}
        disabled={controlsDisabled}
        aria-label="Next item"
        onClick={() => onSelectAdjacent("next")}
      >
        <SkipForward className="size-4" />
      </Button>
      <Button
        className={cn("col-span-2 lg:order-2 lg:col-span-1", touchButtonClass)}
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
        className={cn(touchButtonClass, "lg:order-4")}
        disabled={controlsDisabled}
        onClick={() => onStepBy(-10_000)}
      >
        -10s
      </Button>
      <Button
        variant="outline"
        className={cn(touchButtonClass, "lg:order-5")}
        disabled={controlsDisabled}
        onClick={() => onStepBy(10_000)}
      >
        +10s
      </Button>
    </div>
  )

  const controls = (
    <SeekScrubber
      currentName={currentName}
      elapsedMs={elapsedMs}
      totalDurationMs={totalDurationMs}
      disabled={controlsDisabled}
      trailing={!title ? viewOnlyBadge : null}
      transport={transport}
      onSeekPreview={onSeekPreview}
      onSeekCommit={onSeekCommit}
    />
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
