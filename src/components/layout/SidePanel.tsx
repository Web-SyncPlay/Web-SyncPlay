"use client"

import { LogsDialog } from "@/components/dialog/LogsDialog"
import { PlaylistPanel } from "@/components/panel/playlist/PlaylistPanel"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ScrollText } from "lucide-react"
import { useState } from "react"
import type { RoomPanelProps } from "./page/types"

export function SidePanel({
  panelProps,
  className,
  showLogsButton = true,
}: {
  panelProps: RoomPanelProps
  className?: string
  showLogsButton?: boolean
}) {
  const [logsOpen, setLogsOpen] = useState(false)

  return (
    <>
      <Card className={className ?? "size-full min-h-0 overflow-hidden"}>
        {showLogsButton ? (
          <div className="flex shrink-0 justify-end px-4 pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLogsOpen(true)}
            >
              <ScrollText className="size-3.5" />
              Logs
            </Button>
          </div>
        ) : null}
        <PlaylistPanel {...panelProps} />
      </Card>
      {showLogsButton ? (
        <LogsDialog
          open={logsOpen}
          onOpenChange={setLogsOpen}
          panelProps={panelProps}
        />
      ) : null}
    </>
  )
}
