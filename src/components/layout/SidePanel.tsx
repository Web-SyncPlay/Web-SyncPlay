"use client"

import { useState } from "react"

import { cn } from "@/components/lib/utils"
import { LogPanel } from "@/components/panel/log/LogPanel"
import { PlaylistPanel } from "@/components/panel/playlist/PlaylistPanel"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import type { RoomRailTab } from "@/hooks/use-room-rail"

import type { RoomPanelProps } from "./page/types"

function SidePanelTabButton(props: {
  label: string
  active: boolean
  onSelect: () => void
}) {
  return (
    <Button
      size="sm"
      variant={props.active ? "default" : "ghost"}
      className={cn(
        "touch-manipulation",
        !props.active && "text-muted-foreground",
      )}
      aria-pressed={props.active}
      onClick={props.onSelect}
    >
      {props.label}
    </Button>
  )
}

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
    <Card
      className={cn("size-full min-h-0 overflow-hidden rounded-lg", className)}
    >
      {hideTabBar ? null : (
        <div
          className="mx-4 mt-3 inline-flex shrink-0 items-center self-start rounded-lg border bg-background p-0.5"
          role="group"
          aria-label="Side panel content"
        >
          <SidePanelTabButton
            label="Playlist"
            active={tab === "playlist"}
            onSelect={() => setTab("playlist")}
          />
          <SidePanelTabButton
            label="Logs"
            active={tab === "log"}
            onSelect={() => setTab("log")}
          />
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
