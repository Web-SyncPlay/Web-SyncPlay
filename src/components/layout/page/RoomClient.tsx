"use client"

import { RoomJoinPasswordPrompt } from "@/components/dialog/RoomJoinPasswordPrompt"
import { PlaylistDrawer } from "@/components/layout/PlaylistDrawer"
import { RemotePrepPanel } from "@/components/layout/RemotePrepPanel"
import { RoomTransportBar } from "@/components/layout/RoomTransportBar"
import { SidePanel } from "@/components/layout/SidePanel"
import { SiteNavbar } from "@/components/layout/SiteNavbar"
import { SocketStatus } from "@/components/layout/SocketStatus"
import { UsersStrip } from "@/components/layout/UsersStrip"
import { PlayerPanel } from "@/components/panel/player/PlayerPanel"
import { useRoomLayoutMode } from "@/hooks/use-room-layout-mode"
import { useRoomSession } from "@/hooks/use-room-session"
import { getRoomUrl } from "@/lib/control-url"
import { canControlPlayback } from "@/lib/permissions-utils"
import { cn } from "@/lib/utils"
import type { RoomSecurityState } from "@/zod/types"
import type { RoomPanelProps } from "./types"

export function RoomClient({ roomId }: { roomId: string }) {
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
  } = useRoomSession(roomId, { sessionKind: "room" })

  if (!roomState) {
    if (status === "awaiting_password") {
      return (
        <RoomJoinPasswordPrompt
          roomId={roomId}
          title={joinError}
          onSubmit={submitJoinPassword}
        />
      )
    }

    return <SocketStatus status={status} />
  }

  const myRole = roomState.participants[userId]?.role
  const canControlByRole = canControlPlayback(myRole)
  const canMutateFromThisSession =
    canControlByRole &&
    (!sessionCapabilities.isControlSession ||
      sessionCapabilities.controlAuthorized)
  const panelProps = {
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
  const current = roomState.playlist[roomState.currentIndex]
  const showViewMenu = canControlByRole

  return (
    <RoomClientReady
      roomId={roomId}
      panelProps={panelProps}
      currentName={current?.name}
      paused={roomState.playback.paused}
      canControlByRole={canControlByRole}
      showViewMenu={showViewMenu}
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
  showViewMenu: boolean
  roomUrl: string
  playerEmbedUrl: string
  controlEmbedUrl: string
  shareUrl: string
  copied: boolean
  handleCopyShareUrl: () => void
  roomSecurity: RoomSecurityState
  canManageRoomSecurity: boolean
  send: RoomPanelProps["send"]
}) {
  const {
    roomId,
    panelProps,
    currentName,
    paused,
    canControlByRole,
    showViewMenu,
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

  const { layoutMode, setLayoutMode } = useRoomLayoutMode({
    canSwitchModes: canControlByRole,
    defaultMode: canControlByRole ? "manage" : "watch",
  })

  const showMobileTransport =
    canControlByRole && (layoutMode === "watch" || layoutMode === "manage")

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
        showViewMenu={showViewMenu}
        showLayoutModes={canControlByRole}
        layoutMode={layoutMode}
        onLayoutModeChange={setLayoutMode}
      />

      {layoutMode === "remote" ? (
        <section className="flex flex-1 flex-col gap-3 px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <RemotePrepPanel controlEmbedUrl={controlEmbedUrl} />
          <UsersStrip {...panelProps} />
        </section>
      ) : null}

      {layoutMode === "watch" ? (
        <section
          className={cn(
            "flex flex-1 flex-col gap-2 px-2",
            showMobileTransport
              ? "pb-[calc(12rem+env(safe-area-inset-bottom))] lg:pb-2"
              : "pb-20 lg:pb-2",
          )}
        >
          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
            <PlayerPanel {...panelProps} className="min-h-0 w-full" />
            <SidePanel
              panelProps={panelProps}
              className="hidden min-h-0 overflow-hidden lg:flex lg:flex-col"
            />
          </div>
          <UsersStrip {...panelProps} />
          {showMobileTransport ? (
            <div className="fixed inset-x-0 bottom-0 z-20 lg:hidden">
              <RoomTransportBar {...panelProps} />
            </div>
          ) : null}
          <PlaylistDrawer
            panelProps={panelProps}
            offsetForTransport={showMobileTransport}
          />
        </section>
      ) : null}

      {layoutMode === "manage" ? (
        <section
          className={cn(
            "flex flex-1 flex-col gap-2 px-2",
            "pb-[calc(12rem+env(safe-area-inset-bottom))] lg:pb-2",
          )}
        >
          <div className="grid gap-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,1fr)]">
            <div className="flex min-w-0 flex-col gap-2">
              <PlayerPanel {...panelProps} className="min-h-0 w-full" />
              <div className="hidden lg:block">
                <RoomTransportBar {...panelProps} />
              </div>
            </div>
            <SidePanel
              panelProps={panelProps}
              className={cn(
                "hidden min-h-0 overflow-hidden lg:flex lg:flex-col",
              )}
            />
          </div>
          <UsersStrip {...panelProps} />
          <div className="fixed inset-x-0 bottom-0 z-20 lg:hidden">
            <RoomTransportBar {...panelProps} />
          </div>
          <PlaylistDrawer panelProps={panelProps} offsetForTransport />
        </section>
      ) : null}
    </>
  )
}
