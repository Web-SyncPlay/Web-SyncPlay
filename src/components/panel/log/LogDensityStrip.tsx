"use client"

import { useCallback, useMemo, useRef, useState } from "react"

import { cn } from "@/components/lib/utils"
import type { ActionLogEntry } from "@/contracts/types"
import {
  getActionCategory,
  getActionLogDetails,
  type LogActionCategory,
} from "@/shared/log-format"

const categoryToneClass: Record<LogActionCategory, string> = {
  presence: "bg-secondary-foreground/50",
  playback: "bg-primary",
  playlist: "bg-foreground/55",
  error: "bg-destructive",
}

type BrushState = {
  originRatio: number
  currentRatio: number
} | null

function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * Compact 1D overview of the room action log (SeeSoft / LogSpider-inspired).
 * Brush to set a time window; search matches are emphasized.
 */
export function LogDensityStrip(props: {
  logs: ActionLogEntry[]
  query: string
  timeStartMs: number | null
  timeEndMs: number | null
  onTimeRangeChange: (
    timeStartMs: number | null,
    timeEndMs: number | null,
  ) => void
}) {
  const { logs, query, timeStartMs, timeEndMs, onTimeRangeChange } = props
  const trackRef = useRef<HTMLDivElement>(null)
  const [brush, setBrush] = useState<BrushState>(null)

  const bounds = useMemo(() => {
    if (logs.length === 0) {
      return { minAt: 0, maxAt: 1, span: 1 }
    }
    let minAt = logs[0]!.at
    let maxAt = logs[0]!.at
    for (const log of logs) {
      if (log.at < minAt) minAt = log.at
      if (log.at > maxAt) maxAt = log.at
    }
    // Pad a little so edge marks stay visible.
    const pad = Math.max(1_000, Math.round((maxAt - minAt) * 0.02))
    minAt -= pad
    maxAt += pad
    return { minAt, maxAt, span: Math.max(1, maxAt - minAt) }
  }, [logs])

  const ratioFromClientX = useCallback((clientX: number) => {
    const el = trackRef.current
    if (!el) {
      return 0
    }
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) {
      return 0
    }
    return clampRatio((clientX - rect.left) / rect.width)
  }, [])

  const commitBrush = useCallback(
    (originRatio: number, currentRatio: number) => {
      const startRatio = Math.min(originRatio, currentRatio)
      const endRatio = Math.max(originRatio, currentRatio)
      // Tiny drag = clear brush (treat as click).
      if (endRatio - startRatio < 0.02) {
        onTimeRangeChange(null, null)
        return
      }
      onTimeRangeChange(
        Math.round(bounds.minAt + startRatio * bounds.span),
        Math.round(bounds.minAt + endRatio * bounds.span),
      )
    },
    [bounds.minAt, bounds.span, onTimeRangeChange],
  )

  const selection =
    brush !== null
      ? {
          left: Math.min(brush.originRatio, brush.currentRatio),
          width: Math.abs(brush.currentRatio - brush.originRatio),
        }
      : timeStartMs !== null && timeEndMs !== null
        ? {
            left: clampRatio((timeStartMs - bounds.minAt) / bounds.span),
            width: clampRatio((timeEndMs - timeStartMs) / bounds.span),
          }
        : null

  const q = query.trim().toLowerCase()

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-[0.7rem] text-muted-foreground">
        <span>Activity overview</span>
        {timeStartMs !== null || timeEndMs !== null ? (
          <button
            type="button"
            className="underline-offset-2 hover:underline"
            onClick={() => onTimeRangeChange(null, null)}
          >
            Clear time range
          </button>
        ) : (
          <span>Drag to zoom</span>
        )}
      </div>
      <div
        ref={trackRef}
        role="img"
        aria-label="Action log activity over time. Drag to select a time range."
        className="relative h-8 cursor-crosshair touch-none overflow-hidden rounded-md border bg-muted/30"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          const ratio = ratioFromClientX(event.clientX)
          setBrush({ originRatio: ratio, currentRatio: ratio })
        }}
        onPointerMove={(event) => {
          if (brush === null) {
            return
          }
          setBrush({
            originRatio: brush.originRatio,
            currentRatio: ratioFromClientX(event.clientX),
          })
        }}
        onPointerUp={(event) => {
          if (brush === null) {
            return
          }
          const currentRatio = ratioFromClientX(event.clientX)
          commitBrush(brush.originRatio, currentRatio)
          setBrush(null)
        }}
        onPointerCancel={() => setBrush(null)}
      >
        {selection ? (
          <div
            className="pointer-events-none absolute inset-y-0 bg-primary/15"
            style={{
              left: `${selection.left * 100}%`,
              width: `${Math.max(selection.width, 0.01) * 100}%`,
            }}
          />
        ) : null}
        {logs.map((log) => {
          const category = getActionCategory(log.action)
          if (!category) {
            return null
          }
          const left = ((log.at - bounds.minAt) / bounds.span) * 100
          const isMatch =
            q.length > 0 &&
            `${log.action} ${log.actorUsername ?? ""} ${getActionLogDetails(log)} ${log.error ?? ""}`
              .toLowerCase()
              .includes(q)
          return (
            <span
              key={log.id}
              className={cn(
                "pointer-events-none absolute top-1 bottom-1 w-0.5 rounded-full opacity-70",
                categoryToneClass[category],
                q.length > 0 && !isMatch && "opacity-20",
                isMatch && "opacity-100 ring-1 ring-primary",
              )}
              style={{ left: `${left}%` }}
            />
          )
        })}
      </div>
    </div>
  )
}
