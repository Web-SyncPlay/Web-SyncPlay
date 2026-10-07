"use client"

import { RoomJoinPasswordPrompt } from "@/components/dialog/RoomJoinPasswordPrompt"
import type { JoinStatus } from "@/lib/room-join-client"
import { SiteNavbar } from "./SiteNavbar"
import { SocketStatus } from "./SocketStatus"

/** Shared join gate for room / player / control shells while roomState is absent. */
export function RoomConnectingView(props: {
  roomId: string
  status: JoinStatus
  joinError: string | null
  onSubmitJoinPassword: (password: string) => void
}) {
  if (props.status === "awaiting_password") {
    return (
      <>
        <SiteNavbar roomId={props.roomId} bare />
        <RoomJoinPasswordPrompt
          roomId={props.roomId}
          error={props.joinError}
          onSubmit={props.onSubmitJoinPassword}
        />
      </>
    )
  }

  return <SocketStatus status={props.status} />
}
