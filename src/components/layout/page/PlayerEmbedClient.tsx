"use client"

import { RoomJoinPasswordPrompt } from "@/components/dialog/RoomJoinPasswordPrompt"
import { useRoomSession } from "@/hooks/use-room-session"
import { getRoomUrl } from "@/lib/control-url"
import { canControlPlayback } from "@/lib/permissions-utils"
import { PlayerPanel } from "../../panel/player/PlayerPanel"
import { SiteNavbar } from "../SiteNavbar"
import { SocketStatus } from "../SocketStatus"

export function PlayerEmbedClient({ roomId }: { roomId: string }) {
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
  } = useRoomSession(roomId, { sessionKind: "player" })

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
  const current = roomState.playlist[roomState.currentIndex]

  return (
    <>
      <SiteNavbar
        roomId={roomId}
        paused={roomState.playback.paused}
        currentName={current?.name}
        viewMode="player"
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
        showEmbedsMenu={canControlByRole}
      />
      <section className="grid px-2">
        <PlayerPanel
          roomState={roomState}
          roomId={roomId}
          userId={userId}
          userSecret={userSecret}
          send={send}
          capabilities={{
            ...sessionCapabilities,
            canControlPlayback: canMutateFromThisSession,
            canManagePlaylist: canMutateFromThisSession,
          }}
        />
      </section>
    </>
  )
}
