"use client"

import { cn } from "@/components/lib/utils"
import { slider04ClassName } from "@/components/shadcn-space/slider/slider-04-classes"
import { Slider } from "@/components/ui/slider"
import { formatClockMs } from "@/shared/time-format"
import { cloneElement, isValidElement, useState, type ReactNode } from "react"

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
  /** Transport controls rendered in the shared row beside the seek track. */
  transport?: ReactNode
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
    transport,
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
  const clocksLabel = `${formatClockMs(clampedMs)} / ${durationLabel}`

  const titleRow = (rowClassName: string) => (
    <div className={cn("flex items-center gap-2", rowClassName)}>
      <p className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight text-foreground">
        {currentName ?? "No media selected"}
      </p>
      {isValidElement(trailing) ? cloneElement(trailing) : trailing}
      <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
        {clocksLabel}
      </span>
    </div>
  )

  const slider = (
    <Slider
      min={0}
      max={durationKnown ? totalDurationMs : 1}
      value={value}
      className={cn(
        slider04ClassName,
        transport
          ? "h-10 sm:h-full sm:min-h-10 lg:h-10 lg:min-h-10 lg:flex-none"
          : undefined,
      )}
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
  )

  if (!transport) {
    return (
      <div className={cn("w-full", className)}>
        {titleRow("mb-2")}
        {slider}
      </div>
    )
  }

  return (
    <div className={cn("w-full", className)}>
      {/* lg+: title stays above the shared transport + scrubber row */}
      {titleRow("mb-2 hidden lg:flex")}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch sm:gap-3">
        <div className="w-full shrink-0 sm:w-40 lg:w-max">{transport}</div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          {/* sm–lg: title + clocks share the scrubber column */}
          {titleRow("hidden sm:flex lg:hidden")}
          <div className="flex min-h-0 min-w-0 flex-1 items-stretch lg:items-center">
            {slider}
          </div>
        </div>
      </div>

      {/* < sm: title + clocks share a truncated bottom row */}
      {titleRow("mt-2 sm:hidden")}
    </div>
  )
}
