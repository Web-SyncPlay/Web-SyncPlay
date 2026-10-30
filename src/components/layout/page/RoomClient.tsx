"use client"

import { useState } from "react"

import { peekLandingSkipDefaultMedia } from "@/client/local-media/local-media-landing-handoff"
import { RoomConnectingView } from "@/components/layout/RoomConnectingView"
import { SidePanel } from "@/components/layout/SidePanel"
import { SiteNavbar } from "@/components/layout/SiteNavbar"
import { cn } from "@/components/lib/utils"
import { PlayerPanel } from "@/components/panel/player/PlayerPanel"
import { UsersPanel } from "@/components/panel/user/UsersPanel"
import { useRoomRail } from "@/hooks/use-room-rail"
import { useRoomSession } from "@/hooks/use-room-session"

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
  // Peek only — File handoff is consumed later by PlaylistAddMediaControls.
  const [seedSkipDefaultMedia] = useState(() =>
    typeof window !== "undefined" ? peekLandingSkipDefaultMedia(roomId) : false,
  )
  const session = useRoomSession(roomId, {
    sessionKind: "room",
    initialMediaUrl: seedMediaUrl,
    skipDefaultMedia: seedSkipDefaultMedia,
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
      roomUrl={session.roomUrl}
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
            // Side-by-side: player sizes the row; rail stretches to match (h-0
            // keeps playlist/log content from inflating the track).
            railOpen &&
              "lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] lg:items-stretch",
          )}
        >
          <PlayerPanel
            {...panelProps}
            className={cn(
              "h-auto min-h-0 w-full",
              // Rail open: keep the player from dominating the viewport.
              // Collapsed: full-width 16:9 already keeps height in check.
              railOpen && "max-h-[70vh]",
            )}
            // Playlist rail already has add controls — avoid a duplicate form.
            showEmptyAddControls={!(railOpen && railTab === "playlist")}
          />
          {railOpen ? (
            <SidePanel
              panelProps={panelProps}
              hideTabBar
              tab={railTab}
              onTabChange={setRailTab}
              className={cn(
                // Stacked: grow with content, then scroll at the cap.
                "max-h-[70vh] min-h-0 overflow-hidden max-lg:h-auto",
                // Beside player: row height comes from the player only.
                "lg:h-0 lg:max-h-[70vh] lg:min-h-full",
              )}
            />
          ) : null}
        </div>
        <UsersPanel {...panelProps} />
      </section>
    </>
  )
}
