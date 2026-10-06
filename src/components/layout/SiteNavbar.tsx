"use client"

import { RoomDefaultJoinRoleSection } from "@/components/dialog/RoomDefaultJoinRoleSection"
import { RoomJoinPasswordSection } from "@/components/dialog/RoomJoinPasswordSection"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { env } from "@/env"
import type { RoomRailTab } from "@/hooks/use-room-rail"
import type { TypedRoomEventSender } from "@/lib/room-events"
import { cn } from "@/lib/utils"
import type { RoomSecurityState } from "@/zod/types"
import {
  Check,
  Copy,
  ExternalLink,
  PanelRightClose,
  PanelRightOpen,
  Rows3,
  Settings,
} from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { QRCodeSVG } from "qrcode.react"
import { toast } from "sonner"

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
  showEmbedsMenu?: boolean
  showRailControls?: boolean
  railOpen?: boolean
  onToggleRail?: () => void
  railTab?: RoomRailTab
  onRailTabChange?: (tab: RoomRailTab) => void
}) {
  const {
    roomId,
    paused,
    currentName,
    viewMode,
    roomUrl,
    playerEmbedUrl,
    controlEmbedUrl,
    copied,
    onCopyShareUrl,
    roomSecurity,
    canManageRoomSecurity = false,
    send,
    showEmbedsMenu = true,
    showRailControls = false,
    railOpen = true,
    onToggleRail,
    railTab = "playlist",
    onRailTabChange,
  } = props

  const openInNewWindow = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer")
  }

  const copyControlUrl = async () => {
    try {
      await navigator.clipboard.writeText(controlEmbedUrl)
      toast.success("Control URL copied")
    } catch {
      toast.error("Failed to copy control URL")
    }
  }

  const navControlClass = "min-h-10 touch-manipulation gap-1.5 sm:min-h-8"
  const navTriggerClass = cn(
    buttonVariants({ variant: "outline", size: "sm" }),
    navControlClass,
  )

  return (
    <header className="sticky top-0 z-20 border-b bg-background/95">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
          <Link href={"/"} className="flex shrink-0 items-center gap-1.5">
            <Image
              src={"/logo_white.png"}
              alt={"Web-SyncPlay logo"}
              width={36}
              height={36}
            />
            <span className="hidden sm:block">
              {env.NEXT_PUBLIC_APP_NAME}
            </span>
          </Link>
          <Separator orientation="vertical" className="mx-4 h-6 self-center" />
          <span className="ml-0.5 text-base font-semibold tracking-tight">
            Room {roomId}
          </span>
          <Badge variant={paused ? "outline" : "secondary"}>
            {paused ? "Paused" : "Playing"}
          </Badge>
          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <span className="truncate">Playing: {currentName ?? "None"}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(navControlClass, "shrink-0")}
              onClick={onCopyShareUrl}
            >
              {copied ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
              <span>{copied ? "Copied" : "Copy room link"}</span>
            </Button>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showEmbedsMenu ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={navTriggerClass}
                aria-label="Open embeds menu"
              >
                <Rows3 className="size-4" />
                Embeds
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-[min(calc(100vw-1.5rem),22rem)] p-3"
              >
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
                <div
                  className="flex flex-col gap-3 px-1 py-2"
                  onPointerDown={(event) => event.preventDefault()}
                >
                  <div>
                    <p className="text-sm font-medium">Control remotely</p>
                    <p className="text-xs text-muted-foreground">
                      Scan this QR code on your phone to open the control
                      embed and operate playback from another device.
                    </p>
                  </div>
                  <div className="w-full rounded-lg bg-white p-3">
                    <QRCodeSVG
                      value={controlEmbedUrl}
                      size={320}
                      className="h-auto w-full"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={copyControlUrl}
                  >
                    <Copy className="size-4" />
                    Copy control URL
                  </Button>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {canManageRoomSecurity && send && roomSecurity ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={navTriggerClass}
                aria-label="Open room settings"
              >
                <Settings className="size-4" />
                <span className="hidden sm:inline">Settings</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-[min(calc(100vw-1.5rem),22rem)] p-3"
              >
                <div
                  className="flex flex-col gap-4"
                  onPointerDown={(event) => event.preventDefault()}
                >
                  <RoomJoinPasswordSection
                    roomSecurity={roomSecurity}
                    canManageRoomSecurity={canManageRoomSecurity}
                    send={send}
                  />
                  <DropdownMenuSeparator />
                  <RoomDefaultJoinRoleSection
                    roomSecurity={roomSecurity}
                    canManageRoomSecurity={canManageRoomSecurity}
                    send={send}
                  />
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {showRailControls ? (
            <>
              <Tooltip>
                <TooltipTrigger
                  className={cn(navTriggerClass, "px-2")}
                  aria-label={railOpen ? "Hide panel" : "Show panel"}
                  aria-pressed={railOpen}
                  onClick={onToggleRail}
                >
                  {railOpen ? (
                    <PanelRightClose className="size-4" />
                  ) : (
                    <PanelRightOpen className="size-4" />
                  )}
                </TooltipTrigger>
                <TooltipContent>
                  {railOpen ? "Hide panel" : "Show panel"}
                </TooltipContent>
              </Tooltip>
              {railOpen ? (
                <div
                  className="inline-flex h-10 items-center rounded-lg border border-border bg-background p-0.5 sm:h-8"
                  role="group"
                  aria-label="Side panel content"
                >
                  <Button
                    size="sm"
                    variant={railTab === "playlist" ? "secondary" : "ghost"}
                    className={cn(
                      "h-full min-h-0 touch-manipulation",
                      railTab !== "playlist" && "text-muted-foreground",
                    )}
                    aria-pressed={railTab === "playlist"}
                    onClick={() => onRailTabChange?.("playlist")}
                  >
                    Playlist
                  </Button>
                  <Button
                    size="sm"
                    variant={railTab === "log" ? "secondary" : "ghost"}
                    className={cn(
                      "h-full min-h-0 touch-manipulation",
                      railTab !== "log" && "text-muted-foreground",
                    )}
                    aria-pressed={railTab === "log"}
                    onClick={() => onRailTabChange?.("log")}
                  >
                    Logs
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </header>
  )
}
