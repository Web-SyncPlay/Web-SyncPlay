"use client"

import { RoomConnectingView } from "@/components/layout/RoomConnectingView"
import { useRoomSession } from "@/hooks/use-room-session"
import { PlayerPanel } from "../../panel/player/PlayerPanel"
import { useRoomPanelModel } from "./use-room-panel-model"

export function PlayerEmbedClient({ roomId }: { roomId: string }) {
  const session = useRoomSession(roomId, { sessionKind: "player" })
  const model = useRoomPanelModel({ roomId, session })

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
