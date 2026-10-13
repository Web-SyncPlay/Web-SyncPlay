"use client"

import { useState, type ReactNode } from "react"
import { cn } from "@/components/lib/utils"
import { slider04ClassName } from "@/components/shadcn-space/slider/slider-04-classes"
import { Slider } from "@/components/ui/slider"
import { formatClockMs } from "@/shared/time-format"

function getSliderTargetMs(values: number | readonly number[]): number {
  if (Array.isArray(values)) {
    return Math.max(0, Number(values[0] ?? 0))
  }
  return Math.max(0, Number(values))
}

export function SeekScrubber(props: {
  currentName?: string
  elapsedMs: number
  /** `null` when catalog/player duration is unknown — never treat as 0. */
  totalDurationMs: number | null
  disabled: boolean
  trailing?: ReactNode
  className?: string
  onSeekPreview: (targetMs: number, active: boolean) => void
  onSeekCommit: (targetMs: number) => void
}) {
  const {
    currentName,
    elapsedMs,
    totalDurationMs,
    disabled,
    trailing,
    className,
    onSeekPreview,
    onSeekCommit,
  } = props

  const durationKnown =
    typeof totalDurationMs === "number" &&
    Number.isFinite(totalDurationMs) &&
    totalDurationMs > 0

  const [scrubbing, setScrubbing] = useState(false)
  const [previewMs, setPreviewMs] = useState(elapsedMs)

  const displayMs = scrubbing ? previewMs : elapsedMs
  const clampedMs = durationKnown
    ? Math.min(Math.max(0, displayMs), totalDurationMs)
    : 0
  const value = [clampedMs]
  const durationLabel = durationKnown ? formatClockMs(totalDurationMs) : "--:--"

  return (
    <div className={cn("w-full", className)}>
      <div className="mb-2 flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight text-foreground">
          {currentName ?? "No media selected"}
        </p>
        {trailing}
        <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
          {durationLabel}
        </span>
      </div>

      <Slider
        min={0}
        max={durationKnown ? totalDurationMs : 1}
        value={value}
        className={slider04ClassName}
        aria-label="Seek playback position"
        aria-valuetext={
          durationKnown
            ? formatClockMs(clampedMs)
            : "Duration unknown; scrubbing unavailable"
        }
        disabled={disabled || !durationKnown}
        onValueChange={(values) => {
          if (disabled || !durationKnown) {
            return
          }
          const targetMs = getSliderTargetMs(values)
          setScrubbing(true)
          setPreviewMs(targetMs)
          onSeekPreview(targetMs, true)
        }}
        onValueCommitted={(values) => {
          if (disabled || !durationKnown) {
            return
          }
          const targetMs = getSliderTargetMs(values)
          setPreviewMs(targetMs)
          setScrubbing(false)
          onSeekPreview(targetMs, false)
          onSeekCommit(targetMs)
        }}
      />

      <p className="mt-2 text-xl font-medium tracking-tight text-foreground tabular-nums">
        {formatClockMs(clampedMs)}
      </p>
    </div>
  )
}
