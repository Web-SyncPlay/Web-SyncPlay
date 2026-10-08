"use client"

import { RoomConnectingView } from "@/components/layout/RoomConnectingView"
import { useRoomSession } from "@/hooks/use-room-session"
import { canMutateFromClientSession } from "@/lib/permissions-utils"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { PlayerPanel } from "../../panel/player/PlayerPanel"
import { MediaUrlUnsupportedView } from "./MediaUrlUnsupportedView"

export function EmbedClient({
  roomId,
  initialMediaUrl,
}: {
  roomId: string
  /** Raw `?media=` value when present (validated on create by the server). */
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
  } = useRoomSession(roomId, {
    sessionKind: "embed",
    initialMediaUrl: seedMediaUrl,
  })

  useEffect(() => {
    // Existing rooms ignore create-time media — strip after a successful join.
    if (!roomState || !seedMediaUrl) return
    if (typeof window === "undefined") return
    const url = new URL(window.location.href)
    if (!url.searchParams.has("media")) return
    url.searchParams.delete("media")
    const next = `${url.pathname}${url.search}${url.hash}`
    router.replace(next)
  }, [roomState, seedMediaUrl, router])

  if (status === "media_unsupported") {
    return (
      <MediaUrlUnsupportedView roomId={roomId} mediaUrl={seedMediaUrl} />
    )
  }

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
    sessionKind: sessionCapabilities.sessionKind,
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
