"use client"

import { cn } from "@/components/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { ActionLogEntry } from "@/contracts/types"
import {
  categoryLabelByType,
  formatLogTimestamp,
  getActionCategory,
  getActionLogDetails,
  getActionLogPayloadRows,
  highlightQuerySegments,
  type LogActionCategory,
} from "@/shared/log-format"
import { AlertCircle, ChevronDown, ChevronRight } from "lucide-react"
import { useState } from "react"

function resolveActorName(
  log: ActionLogEntry,
  participantUsernames: Record<string, string>,
): string {
  return (
    log.actorUsername ??
    participantUsernames[log.actorUserId] ??
    log.actorUserId
  )
}

function HighlightedText(props: { text: string; query: string }) {
  const segments = highlightQuerySegments(props.text, props.query)
  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          <mark
            key={`${index}-${segment.text}`}
            className="rounded-sm bg-primary/20 text-foreground"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={`${index}-${segment.text}`}>{segment.text}</span>
        ),
      )}
    </>
  )
}

const categoryBadgeVariant: Record<
  LogActionCategory,
  "secondary" | "outline" | "destructive" | "default"
> = {
  presence: "secondary",
  playback: "default",
  playlist: "outline",
  error: "destructive",
}

export function LogItem(props: {
  log: ActionLogEntry
  participantUsernames: Record<string, string>
  query: string
  onFilterActor: (userId: string) => void
  onFilterAction: (action: string) => void
  onFilterCategory: (category: LogActionCategory) => void
}) {
  const {
    log,
    participantUsernames,
    query,
    onFilterActor,
    onFilterAction,
    onFilterCategory,
  } = props
  const [expanded, setExpanded] = useState(false)
  const category = getActionCategory(log.action)
  const isError = category === "error"
  const actorName = resolveActorName(log, participantUsernames)
  const details = getActionLogDetails(log)
  const payloadRows = getActionLogPayloadRows(log)
  const canExpand = payloadRows.length > 0

  return (
    <div
      role="listitem"
      className={cn(
        "border-b border-border/40 py-1.5 text-pretty leading-snug last:border-b-0 [content-visibility:auto] [contain-intrinsic-size:auto_2.75rem]",
        isError && "bg-destructive/5",
      )}
    >
      <div className="flex items-start gap-1.5">
        {canExpand ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="mt-0.5 shrink-0 text-muted-foreground"
            aria-expanded={expanded}
            aria-label={expanded ? "Hide details" : "Show details"}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <ChevronDown /> : <ChevronRight />}
          </Button>
        ) : (
          <span className="mt-0.5 inline-flex size-6 shrink-0" aria-hidden />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="text-muted-foreground tabular-nums">
              {formatLogTimestamp(log.at)}
            </span>
            {category ? (
              <Badge
                variant={categoryBadgeVariant[category]}
                className="h-5 cursor-pointer"
                render={<button type="button" />}
                aria-label={`Filter by ${categoryLabelByType[category]}`}
                onClick={() => onFilterCategory(category)}
              >
                {categoryLabelByType[category]}
              </Badge>
            ) : null}
            {isError ? (
              <AlertCircle
                className="size-3.5 shrink-0 text-destructive"
                aria-hidden
              />
            ) : null}
            <button
              type="button"
              className="cursor-pointer font-medium underline-offset-2 hover:underline"
              onClick={() => onFilterActor(log.actorUserId)}
            >
              <HighlightedText text={actorName} query={query} />
            </button>
            <span className="text-muted-foreground">·</span>
            <button
              type="button"
              className="cursor-pointer text-left underline-offset-2 hover:underline"
              onClick={() => onFilterAction(log.action)}
            >
              <HighlightedText text={details} query={query} />
            </button>
          </div>

          {expanded && canExpand ? (
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-md bg-muted/40 px-2 py-1.5 text-[0.7rem] text-muted-foreground">
              {payloadRows.map((row) => (
                <div key={row.key} className="contents">
                  <dt className="font-medium text-foreground/80">{row.key}</dt>
                  <dd className="min-w-0 break-all">
                    <HighlightedText text={row.value} query={query} />
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </div>
    </div>
  )
}
