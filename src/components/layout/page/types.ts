import type { TypedRoomEventSender } from "@/lib/room-events"
import type { RoomState, SessionKind } from "@/zod/types"

export interface RoomPanelProps {
  roomState: RoomState
  roomId: string
  userId: string
  userSecret: string
  send: TypedRoomEventSender
  capabilities: {
    canControlPlayback: boolean
    canManagePlaylist: boolean
    canManageRoomSecurity: boolean
    isControlSession: boolean
    controlAuthorized: boolean
    sessionKind?: SessionKind
  }
}
