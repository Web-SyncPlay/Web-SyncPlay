import type { RoomStateStorePort } from "@/server/realtime/ports"
import type { SessionKind, WsEnvelope } from "@/contracts/types"
import type { WebSocket } from "ws"

export type RoomMessageContext = {
  ws: WebSocket
  store: RoomStateStorePort
  roomId: string
  userId: string
  /** Identifies this WS among multi-tab connections for the same user. */
  connectionId: string
  controlAuthorized: boolean
  isControlSession: boolean
  sessionKind: SessionKind
}

export type RoomMessageHandler = (
  ctx: RoomMessageContext,
  data: WsEnvelope<string, Record<string, unknown>>,
) => Promise<void>

export type JoinContext = {
  ws: WebSocket
  store: RoomStateStorePort
}

export type JoinHandler = (
  ctx: JoinContext,
  data: WsEnvelope<string, Record<string, unknown>>,
) => Promise<void>
