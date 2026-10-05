import type { RoomStateStore } from "@/server/redis/state-store"
import type { SessionKind, WsEnvelope } from "@/zod/types"
import type { WebSocket } from "ws"

export type RoomMessageContext = {
  ws: WebSocket
  store: RoomStateStore
  roomId: string
  userId: string
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
  store: RoomStateStore
}

export type JoinHandler = (
  ctx: JoinContext,
  data: WsEnvelope<string, Record<string, unknown>>,
) => Promise<void>
