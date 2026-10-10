import type { TypedRoomEventSender } from "@/contracts/room-events"
import type { ClientRoomState, SessionKind } from "@/contracts/types"

export interface RoomPanelProps {
  roomState: ClientRoomState
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
