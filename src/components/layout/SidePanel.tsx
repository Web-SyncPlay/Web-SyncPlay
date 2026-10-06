"use client"

import { LogPanel } from "@/components/panel/log/LogPanel"
import { PlaylistPanel } from "@/components/panel/playlist/PlaylistPanel"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useState } from "react"
import type { RoomRailTab } from "@/hooks/use-room-rail"
import type { RoomPanelProps } from "./page/types"

export function SidePanel({
  panelProps,
  className,
  tab: controlledTab,
  onTabChange,
  hideTabBar = false,
}: {
  panelProps: RoomPanelProps
  className?: string
  tab?: RoomRailTab
  onTabChange?: (tab: RoomRailTab) => void
  hideTabBar?: boolean
}) {
  const [uncontrolledTab, setUncontrolledTab] =
    useState<RoomRailTab>("playlist")
  const tab = controlledTab ?? uncontrolledTab
  const setTab = onTabChange ?? setUncontrolledTab

  return (
    <Card className={className ?? "size-full min-h-0 overflow-hidden"}>
      {hideTabBar ? null : (
        <div className="flex shrink-0 items-center px-4 pt-3">
          <div
            className="inline-flex items-center rounded-lg border bg-background p-0.5"
            role="group"
            aria-label="Side panel content"
          >
            <Button
              size="sm"
              variant={tab === "playlist" ? "default" : "ghost"}
              className={cn(
                "min-h-9 touch-manipulation",
                tab !== "playlist" && "text-muted-foreground",
              )}
              aria-pressed={tab === "playlist"}
              onClick={() => setTab("playlist")}
            >
              Playlist
            </Button>
            <Button
              size="sm"
              variant={tab === "log" ? "default" : "ghost"}
              className={cn(
                "min-h-9 touch-manipulation",
                tab !== "log" && "text-muted-foreground",
              )}
              aria-pressed={tab === "log"}
              onClick={() => setTab("log")}
            >
              Logs
            </Button>
          </div>
        </div>
      )}
      {tab === "playlist" ? (
        <PlaylistPanel {...panelProps} hideTitle />
      ) : (
        <LogPanel {...panelProps} hideTitle />
      )}
    </Card>
  )
}
