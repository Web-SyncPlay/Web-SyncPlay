"use client"

import { CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getFilteredLogs } from "@/shared/log-format"
import { memo, useMemo, useState } from "react"
import type { RoomPanelProps } from "../../layout/page/types"
import { LogFilters } from "./LogFilters"
import { LogList } from "./LogList"
import {
  logShellSlicesEqual,
  selectLogFilterUsers,
  selectLogShellSlice,
  type LogShellSlice,
} from "./log-room-selectors"

type LogPanelShellProps = {
  slice: LogShellSlice
  hideTitle: boolean
}

/**
 * Presence-sensitive outer shell: derives a narrow slice so the memoized
 * body does not re-render on lastSeen/connected churn.
 */
export function LogPanel({
  roomState,
  hideTitle = false,
}: RoomPanelProps & { hideTitle?: boolean }) {
  const slice = selectLogShellSlice(roomState)
  return <LogPanelShell slice={slice} hideTitle={hideTitle} />
}

const LogPanelShell = memo(
  function LogPanelShell({ slice, hideTitle }: LogPanelShellProps) {
    const [actionFilter, setActionFilter] = useState<string>("all")
    const [userFilter, setUserFilter] = useState<string>("all")

    const filteredLogs = useMemo(
      () =>
        getFilteredLogs({
          actionLog: slice.actionLog,
          actionFilter,
          userFilter,
        }),
      [slice.actionLog, actionFilter, userFilter],
    )

    const users = useMemo(() => selectLogFilterUsers(slice), [slice])

    return (
      <>
        <CardHeader className="shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {hideTitle ? null : <CardTitle>Action Log</CardTitle>}
            <LogFilters
              actionFilter={actionFilter}
              userFilter={userFilter}
              users={users}
              onActionFilterChange={setActionFilter}
              onUserFilterChange={setUserFilter}
            />
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col">
          <LogList
            logs={filteredLogs}
            participantUsernames={slice.participantUsernames}
          />
        </CardContent>
      </>
    )
  },
  (prev, next) =>
    prev.hideTitle === next.hideTitle &&
    logShellSlicesEqual(prev.slice, next.slice),
)
