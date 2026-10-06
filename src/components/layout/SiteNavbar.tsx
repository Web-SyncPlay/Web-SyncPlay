"use client"

import { RoomSettingsDialog } from "@/components/dialog/RoomSettingsDialog"
import { ShareRoomDialog } from "@/components/dialog/ShareRoomDialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { env } from "@/env"
import type { RoomLayoutMode } from "@/hooks/use-room-layout-mode"
import type { TypedRoomEventSender } from "@/lib/room-events"
import { cn } from "@/lib/utils"
import type { RoomSecurityState } from "@/zod/types"
import {
  Clapperboard,
  ExternalLink,
  ListMusic,
  Rows3,
  ScreenShare,
  Settings,
  Smartphone,
} from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useState } from "react"

const layoutModeItems: {
  id: RoomLayoutMode
  label: string
  icon: typeof Clapperboard
}[] = [
  { id: "watch", label: "Watch", icon: Clapperboard },
  { id: "manage", label: "Manage", icon: ListMusic },
  { id: "remote", label: "Remote", icon: Smartphone },
]

export function SiteNavbar(props: {
  roomId: string
  paused: boolean
  currentName?: string
  viewMode: "room" | "player" | "control"
  roomUrl: string
  playerEmbedUrl: string
  controlEmbedUrl: string
  shareUrl: string
  copied: boolean
  onCopyShareUrl: () => void
  roomSecurity?: RoomSecurityState
  canManageRoomSecurity?: boolean
  send?: TypedRoomEventSender
  showViewMenu?: boolean
  layoutMode?: RoomLayoutMode
  onLayoutModeChange?: (mode: RoomLayoutMode) => void
  showLayoutModes?: boolean
}) {
  const {
    roomId,
    paused,
    currentName,
    viewMode,
    roomUrl,
    playerEmbedUrl,
    controlEmbedUrl,
    shareUrl,
    copied,
    onCopyShareUrl,
    roomSecurity,
    canManageRoomSecurity = false,
    send,
    showViewMenu = true,
    layoutMode,
    onLayoutModeChange,
    showLayoutModes = false,
  } = props
  const [isShareOpen, setIsShareOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  const openInNewWindow = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer")
  }

  return (
    <>
      <header className="sticky top-0 z-20 border-b bg-background/95">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
            <Link href={"/"} className={"flex shrink-0 items-center gap-1"}>
              <Image
                src={"/logo_white.png"}
                alt={"Web-SyncPlay logo"}
                width={36}
                height={36}
              />
              <span className={"hidden sm:block"}>
                {env.NEXT_PUBLIC_APP_NAME}
              </span>
            </Link>
            <Separator orientation="vertical" />
            <span className="text-base font-semibold">Room {roomId}</span>
            <Badge variant={paused ? "outline" : "secondary"}>
              {paused ? "Paused" : "Playing"}
            </Badge>
            <span className="truncate text-muted-foreground">
              Playing: {currentName ?? "None"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {showLayoutModes && layoutMode && onLayoutModeChange ? (
              <div
                className="inline-flex items-center rounded-lg border bg-background p-0.5"
                role="group"
                aria-label="Room layout mode"
              >
                {layoutModeItems.map((item) => {
                  const Icon = item.icon
                  const active = layoutMode === item.id
                  return (
                    <Button
                      key={item.id}
                      size="sm"
                      variant={active ? "default" : "ghost"}
                      className={cn(
                        "min-h-10 min-w-10 touch-manipulation sm:min-h-8 sm:min-w-0",
                        !active && "text-muted-foreground",
                      )}
                      aria-pressed={active}
                      aria-label={item.label}
                      onClick={() => onLayoutModeChange(item.id)}
                    >
                      <Icon className="size-4 sm:size-3.5" />
                      <span className="hidden sm:inline">{item.label}</span>
                    </Button>
                  )
                })}
              </div>
            ) : null}
            {showViewMenu ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
                  aria-label="Open embed views"
                >
                  <Rows3 className="size-4" />
                  Embeds
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Open in new window</DropdownMenuLabel>
                    <DropdownMenuItem
                      disabled={viewMode === "room"}
                      onClick={() => openInNewWindow(roomUrl)}
                      className="cursor-pointer"
                    >
                      <ExternalLink />
                      Room view
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={viewMode === "player"}
                      onClick={() => openInNewWindow(playerEmbedUrl)}
                      className="cursor-pointer"
                    >
                      <ExternalLink />
                      Player embed
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={viewMode === "control"}
                      onClick={() => openInNewWindow(controlEmbedUrl)}
                      className="cursor-pointer"
                    >
                      <ExternalLink />
                      Control embed
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => openInNewWindow(controlEmbedUrl)}
                    className="cursor-pointer"
                  >
                    <Smartphone />
                    Open on phone
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {canManageRoomSecurity && send ? (
              <Button
                variant="outline"
                onClick={() => setIsSettingsOpen(true)}
              >
                <Settings />
                <span className="hidden sm:inline">Settings</span>
              </Button>
            ) : null}
            <Button onClick={() => setIsShareOpen(true)}>
              <ScreenShare />
              Share
            </Button>
          </div>
        </div>
      </header>
      <ShareRoomDialog
        open={isShareOpen}
        shareUrl={shareUrl}
        copied={copied}
        onOpenChange={setIsShareOpen}
        onCopy={onCopyShareUrl}
      />
      <RoomSettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        roomSecurity={roomSecurity}
        canManageRoomSecurity={canManageRoomSecurity}
        send={send}
      />
    </>
  )
}
