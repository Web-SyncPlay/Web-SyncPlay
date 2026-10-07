"use client"

import { RoomConnectingView } from "@/components/layout/RoomConnectingView"
import { useRoomSession } from "@/hooks/use-room-session"
import { canMutateFromClientSession } from "@/lib/permissions-utils"
import { PlayerPanel } from "../../panel/player/PlayerPanel"

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
  } = useRoomSession(roomId, { sessionKind: "player" })

  if (!roomState) {
    return (
      <RoomConnectingView
        roomId={roomId}
        status={status}
        joinError={joinError}
        onSubmitJoinPassword={submitJoinPassword}
        showNavbar={false}
      />
    )
  }

  const myRole = roomState.participants[userId]?.role
  const canMutateFromThisSession = canMutateFromClientSession({
    role: myRole,
    isControlSession: sessionCapabilities.isControlSession,
    controlAuthorized: sessionCapabilities.controlAuthorized,
  })

  return (
    <section className="min-h-0 flex-1 w-full overflow-hidden">
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
        className="aspect-auto size-full rounded-none"
      />
    </section>
  )
}
