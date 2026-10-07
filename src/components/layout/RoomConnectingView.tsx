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
  /** When false, omit site chrome (player embed). Defaults to true. */
  showNavbar?: boolean
}) {
  if (props.status === "awaiting_password") {
    return (
      <>
        {props.showNavbar === false ? null : (
          <SiteNavbar roomId={props.roomId} bare />
        )}
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
