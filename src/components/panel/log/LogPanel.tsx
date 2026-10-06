"use client"

import { CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getFilteredLogs, getLogUsers } from "@/lib/log-format"
import { useMemo, useState } from "react"
import type { RoomPanelProps } from "../../layout/page/types"
import { LogFilters } from "./LogFilters"
import { LogTable } from "./LogTable"

export function LogPanel({
  roomState,
  hideTitle = false,
}: RoomPanelProps & { hideTitle?: boolean }) {
  const [actionFilter, setActionFilter] = useState<string>("all")
  const [userFilter, setUserFilter] = useState<string>("all")

  const filteredLogs = useMemo(
    () =>
      getFilteredLogs({
        actionLog: roomState.actionLog,
        actionFilter,
        userFilter,
      }),
    [roomState.actionLog, actionFilter, userFilter],
  )

  const users = useMemo(() => getLogUsers(roomState), [roomState])

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
      <CardContent className="flex-1 overflow-y-auto max-h-[60vh]">
        <LogTable logs={filteredLogs} participants={roomState.participants} />
      </CardContent>
    </>
  )
}
