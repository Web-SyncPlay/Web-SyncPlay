"use client"

import { Button } from "@/components/ui/button"
import { ItemGroup } from "@/components/ui/item"
import type { ActionLogEntry } from "@/contracts/types"
import type { LogActionCategory } from "@/shared/log-format"
import { ArrowDown } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { LogItem } from "./LogItem"

function countNewerThan(
  logsOldestFirst: ActionLogEntry[],
  pinnedId: string,
): number {
  const pinnedIndex = logsOldestFirst.findIndex((log) => log.id === pinnedId)
  if (pinnedIndex < 0) {
    return logsOldestFirst.length
  }
  return logsOldestFirst.length - 1 - pinnedIndex
}

export function LogList(props: {
  logs: ActionLogEntry[]
  participantUsernames: Record<string, string>
  query: string
  hasActiveFilters: boolean
  totalVisibleCount: number
  onFilterActor: (userId: string) => void
  onFilterAction: (action: string) => void
  onFilterCategory: (category: LogActionCategory) => void
}) {
  const {
    logs,
    participantUsernames,
    query,
    hasActiveFilters,
    totalVisibleCount,
    onFilterActor,
    onFilterAction,
    onFilterCategory,
  } = props

  // Newest first; toReversed avoids mutating the filtered array on each render.
  const ordered = logs.toReversed()
  const newestId = ordered[0]?.id ?? null
  const scrollRef = useRef<HTMLDivElement>(null)
  const [followLatest, setFollowLatest] = useState(true)
  const [pinnedNewestId, setPinnedNewestId] = useState<string | null>(null)

  const pendingNewCount = useMemo(() => {
    if (followLatest || pinnedNewestId === null) {
      return 0
    }
    return countNewerThan(logs, pinnedNewestId)
  }, [followLatest, pinnedNewestId, logs])

  useEffect(() => {
    if (followLatest) {
      scrollRef.current?.scrollTo({ top: 0 })
    }
  }, [newestId, followLatest])

  if (ordered.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        {totalVisibleCount === 0
          ? "No activity yet"
          : hasActiveFilters
            ? "No matching log entries — try clearing filters"
            : "No matching log entries"}
      </p>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {!followLatest && pendingNewCount > 0 ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center pt-1">
          <Button
            type="button"
            size="xs"
            variant="secondary"
            className="pointer-events-auto"
            onClick={() => {
              setFollowLatest(true)
              setPinnedNewestId(null)
              scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })
            }}
          >
            <ArrowDown />
            {pendingNewCount} new
          </Button>
        </div>
      ) : null}

      <ItemGroup
        ref={scrollRef}
        role="list"
        aria-live="polite"
        aria-relevant="additions"
        className="min-h-0 flex-1 gap-0 overflow-y-auto text-xs"
        onScroll={(event) => {
          const atTop = event.currentTarget.scrollTop < 24
          if (atTop) {
            setFollowLatest(true)
            setPinnedNewestId(null)
            return
          }
          if (followLatest) {
            setFollowLatest(false)
            setPinnedNewestId(newestId)
          }
        }}
      >
        {ordered.map((log) => (
          <LogItem
            key={log.id}
            log={log}
            participantUsernames={participantUsernames}
            query={query}
            onFilterActor={onFilterActor}
            onFilterAction={onFilterAction}
            onFilterCategory={onFilterCategory}
          />
        ))}
      </ItemGroup>
    </div>
  )
}
