"use client"

import { RoomJoinPasswordPrompt } from "@/components/dialog/RoomJoinPasswordPrompt"
import { useRoomSession } from "@/hooks/use-room-session"
import { getRoomUrl } from "@/lib/control-url"
import { canControlPlayback } from "@/lib/permissions-utils"
import { PlayerPanel } from "../../panel/player/PlayerPanel"
import { UsersPanel } from "../../panel/user/UsersPanel"
import { SidePanel } from "../SidePanel"
import { SiteNavbar } from "../SiteNavbar"
import { SocketStatus } from "../SocketStatus"

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
    <>
      <SiteNavbar
        roomId={roomId}
        paused={roomState.playback.paused}
        currentName={current?.name}
        viewMode="room"
        roomUrl={getRoomUrl(roomId)}
        playerEmbedUrl={playerEmbedUrl}
        controlEmbedUrl={controlEmbedUrl}
        shareUrl={shareUrl}
        copied={copied}
        onCopyShareUrl={handleCopyShareUrl}
        roomSecurity={roomState.roomSecurity}
        canManageRoomSecurity={
          roomState.ownerId === userId &&
          sessionCapabilities.canManageRoomSecurity
        }
        send={send}
        showViewMenu={showViewMenu}
      />
      <section className="grid px-2 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <PlayerPanel {...panelProps} />
        <SidePanel panelProps={panelProps} />
        <UsersPanel {...panelProps} />
      </section>
    </>
  )
}
