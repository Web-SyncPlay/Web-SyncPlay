"use client"

import { memo, useMemo } from "react"

import { CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useLogFilters } from "@/hooks/use-log-filters"
import {
  countLogsByCategory,
  getFilteredLogs,
  visibleActionTypes,
} from "@/shared/log-format"

import type { RoomPanelProps } from "../../layout/page/types"
import {
  type LogShellSlice,
  logShellSlicesEqual,
  selectLogFilterUsers,
  selectLogShellSlice,
} from "./log-room-selectors"
import { LogDensityStrip } from "./LogDensityStrip"
import { LogFilters } from "./LogFilters"
import { LogList } from "./LogList"

type LogPanelShellProps = {
  slice: LogShellSlice
  roomId: string
  hideTitle: boolean
}

const visibleActionTypeSet = new Set<string>(visibleActionTypes)

/**
 * Presence-sensitive outer shell: derives a narrow slice so the memoized
 * body does not re-render on lastSeen/connected churn.
 */
export function LogPanel({
  roomState,
  hideTitle = false,
}: RoomPanelProps & { hideTitle?: boolean }) {
  const slice = selectLogShellSlice(roomState)
  return (
    <LogPanelShell
      slice={slice}
      roomId={roomState.roomId}
      hideTitle={hideTitle}
    />
  )
}

const LogPanelShell = memo(
  function LogPanelShell({ slice, roomId, hideTitle }: LogPanelShellProps) {
    const filters = useLogFilters(roomId)

    const visibleLogs = useMemo(
      () =>
        slice.actionLog.filter((log) => visibleActionTypeSet.has(log.action)),
      [slice.actionLog],
    )

    const filteredLogs = useMemo(
      () =>
        getFilteredLogs({
          actionLog: slice.actionLog,
          categories: filters.categories,
          actions: filters.actions,
          userIds: filters.userIds,
          query: filters.query,
          timeStartMs: filters.timeStartMs,
          timeEndMs: filters.timeEndMs,
          participantUsernames: slice.participantUsernames,
        }),
      [
        slice.actionLog,
        slice.participantUsernames,
        filters.categories,
        filters.actions,
        filters.userIds,
        filters.query,
        filters.timeStartMs,
        filters.timeEndMs,
      ],
    )

    /** Facet counts exclude the category facet itself (Flamenco query previews). */
    const categoryCountBase = useMemo(
      () =>
        getFilteredLogs({
          actionLog: slice.actionLog,
          actions: filters.actions,
          userIds: filters.userIds,
          query: filters.query,
          timeStartMs: filters.timeStartMs,
          timeEndMs: filters.timeEndMs,
          participantUsernames: slice.participantUsernames,
        }),
      [
        slice.actionLog,
        slice.participantUsernames,
        filters.actions,
        filters.userIds,
        filters.query,
        filters.timeStartMs,
        filters.timeEndMs,
      ],
    )

    const categoryCounts = useMemo(
      () => countLogsByCategory(categoryCountBase),
      [categoryCountBase],
    )

    const users = useMemo(() => selectLogFilterUsers(slice), [slice])

    /** Strip reflects facet+search filters, not the time brush (LogSpider). */
    const stripLogs = useMemo(
      () =>
        getFilteredLogs({
          actionLog: slice.actionLog,
          categories: filters.categories,
          actions: filters.actions,
          userIds: filters.userIds,
          query: filters.query,
          participantUsernames: slice.participantUsernames,
        }),
      [
        slice.actionLog,
        slice.participantUsernames,
        filters.categories,
        filters.actions,
        filters.userIds,
        filters.query,
      ],
    )

    return (
      <>
        <CardHeader className="shrink-0 space-y-3">
          {hideTitle ? null : <CardTitle>Action Log</CardTitle>}
          <LogDensityStrip
            logs={stripLogs}
            query={filters.query}
            timeStartMs={filters.timeStartMs}
            timeEndMs={filters.timeEndMs}
            onTimeRangeChange={filters.setTimeRange}
          />
          <LogFilters
            query={filters.query}
            categories={filters.categories}
            actions={filters.actions}
            userIds={filters.userIds}
            users={users}
            categoryCounts={categoryCounts}
            matchedCount={filteredLogs.length}
            totalVisibleCount={visibleLogs.length}
            hasActiveFilters={filters.hasActiveFilters}
            timeRangeActive={
              filters.timeStartMs !== null || filters.timeEndMs !== null
            }
            onQueryChange={filters.setQuery}
            onToggleCategory={filters.toggleCategory}
            onToggleUser={filters.toggleUser}
            onToggleAction={filters.toggleAction}
            onClearTimeRange={() => filters.setTimeRange(null, null)}
            onClearFilters={filters.clearFilters}
          />
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col">
          <LogList
            logs={filteredLogs}
            participantUsernames={slice.participantUsernames}
            query={filters.query}
            hasActiveFilters={filters.hasActiveFilters}
            totalVisibleCount={visibleLogs.length}
            onFilterActor={filters.toggleUser}
            onFilterAction={filters.toggleAction}
            onFilterCategory={filters.toggleCategory}
          />
        </CardContent>
      </>
    )
  },
  (prev, next) =>
    prev.hideTitle === next.hideTitle &&
    prev.roomId === next.roomId &&
    logShellSlicesEqual(prev.slice, next.slice),
)
