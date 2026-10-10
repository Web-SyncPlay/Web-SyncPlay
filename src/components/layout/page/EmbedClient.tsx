"use client"

import { RoomConnectingView } from "@/components/layout/RoomConnectingView"
import { useRoomSession } from "@/hooks/use-room-session"
import { useState } from "react"
import { PlayerPanel } from "../../panel/player/PlayerPanel"
import { MediaUrlUnsupportedView } from "./MediaUrlUnsupportedView"
import { useRoomPanelModel } from "./use-room-panel-model"

export function EmbedClient({
  roomId,
  initialMediaUrl,
}: {
  roomId: string
  /** Raw `?media=` value when present (validated on create by the server). */
  initialMediaUrl?: string
}) {
  const [seedMediaUrl] = useState(initialMediaUrl)
  const session = useRoomSession(roomId, {
    sessionKind: "embed",
    initialMediaUrl: seedMediaUrl,
  })
  const model = useRoomPanelModel({
    roomId,
    session,
    seedMediaUrl,
  })

  if (model.mediaUnsupported) {
    return (
      <MediaUrlUnsupportedView roomId={roomId} mediaUrl={seedMediaUrl} />
    )
  }

  if (!model.ready) {
    return (
      <RoomConnectingView
        roomId={roomId}
        status={model.status}
        joinError={model.joinError}
        onSubmitJoinPassword={model.submitJoinPassword}
        showNavbar={false}
      />
    )
  }

  return (
    <section className="min-h-0 flex-1 w-full overflow-hidden">
      <PlayerPanel
        {...model.panelProps}
        className="aspect-auto size-full rounded-none"
      />
    </section>
  )
}
