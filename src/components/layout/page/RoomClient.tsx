"use client"

import { RoomConnectingView } from "@/components/layout/RoomConnectingView"
import { SidePanel } from "@/components/layout/SidePanel"
import { SiteNavbar } from "@/components/layout/SiteNavbar"
import { PlayerPanel } from "@/components/panel/player/PlayerPanel"
import { UsersPanel } from "@/components/panel/user/UsersPanel"
import { useRoomRail } from "@/hooks/use-room-rail"
import { useRoomSession } from "@/hooks/use-room-session"
import { getRoomUrl } from "@/client/realtime/control-url"
import {
  canControlPlayback,
  canMutateFromClientSession,
} from "@/shared/permissions-utils"
import { resolveCurrentPlaylistItem } from "@/shared/playlist-current"
import { cn } from "@/components/lib/utils"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import type { RoomPanelProps } from "./types"

export function RoomClient({
  roomId,
  initialMediaUrl,
}: {
  roomId: string
  initialMediaUrl?: string
}) {
  const router = useRouter()
  const [seedMediaUrl] = useState(initialMediaUrl)
  const {
    roomState,
    sessionCapabilities,
    send,
    userId,
    userSecret,
    status,
    joinError,
    submitJoinPassword,
    copied,
    shareUrl,
    handleCopyShareUrl,
    playerEmbedUrl,
    controlEmbedUrl,
  } = useRoomSession(roomId, {
    sessionKind: "room",
    initialMediaUrl: seedMediaUrl,
  })

  useEffect(() => {
    if (!roomState || !seedMediaUrl) return
    if (typeof window === "undefined") return
    const url = new URL(window.location.href)
    if (!url.searchParams.has("media")) return
    url.searchParams.delete("media")
    const next = `${url.pathname}${url.search}${url.hash}`
    router.replace(next)
  }, [roomState, seedMediaUrl, router])

  if (!roomState) {
    return (
      <RoomConnectingView
        roomId={roomId}
        status={status}
        joinError={joinError}
        onSubmitJoinPassword={submitJoinPassword}
        mediaUrl={seedMediaUrl}
      />
    )
  }

  const myRole = roomState.participants[userId]?.role
  const canControlByRole = canControlPlayback(myRole)
  const canMutateFromThisSession = canMutateFromClientSession({
    role: myRole,
    isControlSession: sessionCapabilities.isControlSession,
    controlAuthorized: sessionCapabilities.controlAuthorized,
    sessionKind: sessionCapabilities.sessionKind,
  })
  const panelProps: RoomPanelProps = {
    roomId,
    roomState,
    send,
    userId,
    userSecret,
    capabilities: {
      ...sessionCapabilities,
      canControlPlayback: canMutateFromThisSession,
      canManagePlaylist: canMutateFromThisSession,
    },
  }
  const current = resolveCurrentPlaylistItem(roomState)

  return (
    <RoomClientReady
      roomId={roomId}
      panelProps={panelProps}
      currentName={current?.name}
      paused={roomState.playback.paused}
      canControlByRole={canControlByRole}
      roomUrl={getRoomUrl(roomId)}
      playerEmbedUrl={playerEmbedUrl}
      controlEmbedUrl={controlEmbedUrl}
      shareUrl={shareUrl}
      copied={copied}
      handleCopyShareUrl={handleCopyShareUrl}
      roomSecurity={roomState.roomSecurity}
      canManageRoomSecurity={
        roomState.ownerId === userId &&
        sessionCapabilities.canManageRoomSecurity
      }
      send={send}
    />
  )
}

function RoomClientReady(props: {
  roomId: string
  panelProps: RoomPanelProps
  currentName?: string
  paused: boolean
  canControlByRole: boolean
  roomUrl: string
  playerEmbedUrl: string
  controlEmbedUrl: string
  shareUrl: string
  copied: boolean
  handleCopyShareUrl: () => void
  roomSecurity: RoomPanelProps["roomState"]["roomSecurity"]
  canManageRoomSecurity: boolean
  send: RoomPanelProps["send"]
}) {
  const {
    roomId,
    panelProps,
    currentName,
    paused,
    canControlByRole,
    roomUrl,
    playerEmbedUrl,
    controlEmbedUrl,
    shareUrl,
    copied,
    handleCopyShareUrl,
    roomSecurity,
    canManageRoomSecurity,
    send,
  } = props

  const { railOpen, railTab, toggleRailOpen, setRailTab } = useRoomRail()

  return (
    <>
      <SiteNavbar
        roomId={roomId}
        paused={paused}
        currentName={currentName}
        viewMode="room"
        roomUrl={roomUrl}
        playerEmbedUrl={playerEmbedUrl}
        controlEmbedUrl={controlEmbedUrl}
        shareUrl={shareUrl}
        copied={copied}
        onCopyShareUrl={handleCopyShareUrl}
        roomSecurity={roomSecurity}
        canManageRoomSecurity={canManageRoomSecurity}
        send={send}
        showEmbedsMenu={canControlByRole}
        showRailControls
        railOpen={railOpen}
        onToggleRail={toggleRailOpen}
        railTab={railTab}
        onRailTabChange={setRailTab}
      />
      <section className="flex flex-1 flex-col gap-2 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div
          className={cn(
            "grid gap-2",
            railOpen &&
              "lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]",
          )}
        >
          <PlayerPanel {...panelProps} className="min-h-0 w-full" />
          {railOpen ? (
            <SidePanel
              panelProps={panelProps}
              hideTabBar
              tab={railTab}
              onTabChange={setRailTab}
              className="min-h-0 max-h-[70vh] overflow-hidden lg:max-h-none"
            />
          ) : null}
        </div>
        <UsersPanel {...panelProps} />
      </section>
    </>
  )
}
