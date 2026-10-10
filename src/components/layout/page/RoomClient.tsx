"use client"

import { RoomConnectingView } from "@/components/layout/RoomConnectingView"
import { SidePanel } from "@/components/layout/SidePanel"
import { SiteNavbar } from "@/components/layout/SiteNavbar"
import { PlayerPanel } from "@/components/panel/player/PlayerPanel"
import { UsersPanel } from "@/components/panel/user/UsersPanel"
import { useRoomRail } from "@/hooks/use-room-rail"
import { useRoomSession } from "@/hooks/use-room-session"
import { getRoomUrl } from "@/client/realtime/control-url"
import { cn } from "@/components/lib/utils"
import { useState } from "react"
import type { RoomPanelProps } from "./types"
import { useRoomPanelModel } from "./use-room-panel-model"

export function RoomClient({
  roomId,
  initialMediaUrl,
}: {
  roomId: string
  initialMediaUrl?: string
}) {
  const [seedMediaUrl] = useState(initialMediaUrl)
  const session = useRoomSession(roomId, {
    sessionKind: "room",
    initialMediaUrl: seedMediaUrl,
  })
  const model = useRoomPanelModel({
    roomId,
    session,
    seedMediaUrl,
  })

  if (!model.ready) {
    return (
      <RoomConnectingView
        roomId={roomId}
        status={model.status}
        joinError={model.joinError}
        onSubmitJoinPassword={model.submitJoinPassword}
        mediaUrl={seedMediaUrl}
      />
    )
  }

  return (
    <RoomClientReady
      roomId={roomId}
      panelProps={model.panelProps}
      currentName={model.current?.name}
      paused={model.roomState.playback.paused}
      canControlByRole={model.canControlByRole}
      roomUrl={getRoomUrl(roomId)}
      playerEmbedUrl={session.playerEmbedUrl}
      controlEmbedUrl={session.controlEmbedUrl}
      shareUrl={session.shareUrl}
      copied={session.copied}
      handleCopyShareUrl={session.handleCopyShareUrl}
      roomSecurity={model.roomState.roomSecurity}
      canManageRoomSecurity={model.canManageRoomSecurity}
      send={model.send}
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
