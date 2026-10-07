import type { SessionKind } from "@/zod/types"
import type { WebSocket } from "ws"

export type SocketMeta = {
  roomId: string
  userId: string
  /** Stable id for this WS so multi-tab playback reports do not clobber each other. */
  connectionId: string
  presenceTracked: boolean
  controlAuthorized: boolean
  isControlSession: boolean
  sessionKind: SessionKind
}

type RegistrySlot = {
  rooms: Map<string, Set<WebSocket>>
  sockets: Map<WebSocket, SocketMeta>
}

function getRegistrySlot(): RegistrySlot {
  const g = globalThis as typeof globalThis & {
    __webSyncPlayWsRegistry?: RegistrySlot
  }
  g.__webSyncPlayWsRegistry ??= {
    rooms: new Map(),
    sockets: new Map(),
  }
  return g.__webSyncPlayWsRegistry
}

function detachFromRoom(
  rooms: Map<string, Set<WebSocket>>,
  roomId: string,
  ws: WebSocket,
) {
  const roomSet = rooms.get(roomId)
  if (!roomSet) return
  roomSet.delete(ws)
  if (roomSet.size === 0) {
    rooms.delete(roomId)
  }
}

function patchSocketMeta(
  ws: WebSocket,
  patch: Partial<Pick<SocketMeta, "presenceTracked" | "controlAuthorized">>,
) {
  const { sockets } = getRegistrySlot()
  const meta = sockets.get(ws)
  if (!meta) return
  sockets.set(ws, { ...meta, ...patch })
}

export function addSocket(
  ws: WebSocket,
  meta: Omit<SocketMeta, "presenceTracked">,
) {
  const { rooms, sockets } = getRegistrySlot()
  const previousMeta = sockets.get(ws)
  if (previousMeta) {
    detachFromRoom(rooms, previousMeta.roomId, ws)
  }

  const roomSet = rooms.get(meta.roomId) ?? new Set<WebSocket>()
  roomSet.add(ws)
  rooms.set(meta.roomId, roomSet)
  sockets.set(ws, {
    roomId: meta.roomId,
    userId: meta.userId,
    connectionId: previousMeta?.connectionId ?? crypto.randomUUID(),
    presenceTracked: previousMeta?.presenceTracked ?? false,
    controlAuthorized: meta.controlAuthorized,
    isControlSession: meta.isControlSession,
    sessionKind: meta.sessionKind,
  })
}

export function setSocketPresenceTracked(
  ws: WebSocket,
  presenceTracked: boolean,
) {
  patchSocketMeta(ws, { presenceTracked })
}

export function setSocketControlAuthorized(
  ws: WebSocket,
  controlAuthorized: boolean,
) {
  patchSocketMeta(ws, { controlAuthorized })
}

export function removeSocket(ws: WebSocket) {
  const { rooms, sockets } = getRegistrySlot()
  const meta = sockets.get(ws)
  if (!meta) {
    return undefined
  }
  sockets.delete(ws)
  detachFromRoom(rooms, meta.roomId, ws)
  return meta
}

export function getSocketMeta(ws: WebSocket) {
  return getRegistrySlot().sockets.get(ws)
}

export function getSocketsForRoom(roomId: string) {
  return getRegistrySlot().rooms.get(roomId) ?? new Set()
}

export function getSocketsForUser(roomId: string, userId: string) {
  const sockets: WebSocket[] = []
  for (const ws of getSocketsForRoom(roomId)) {
    const meta = getSocketMeta(ws)
    if (meta?.userId === userId) {
      sockets.push(ws)
    }
  }
  return sockets
}

export function hasAnySocketInRoom(roomId: string) {
  const set = getRegistrySlot().rooms.get(roomId)
  return (set?.size ?? 0) > 0
}
