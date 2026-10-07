"use client"

import { RoomConnectingView } from "@/components/layout/RoomConnectingView"
import { useRoomSession } from "@/hooks/use-room-session"
import { getRoomUrl } from "@/lib/control-url"
import {
  canControlPlayback,
  canMutateFromClientSession,
} from "@/lib/permissions-utils"
import { PlayerPanel } from "../../panel/player/PlayerPanel"
import { SiteNavbar } from "../SiteNavbar"

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
    return (
      <RoomConnectingView
        roomId={roomId}
        status={status}
        joinError={joinError}
        onSubmitJoinPassword={submitJoinPassword}
      />
    )
  }

  const myRole = roomState.participants[userId]?.role
  const canControlByRole = canControlPlayback(myRole)
  const canMutateFromThisSession = canMutateFromClientSession({
    role: myRole,
    isControlSession: sessionCapabilities.isControlSession,
    controlAuthorized: sessionCapabilities.controlAuthorized,
  })
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
