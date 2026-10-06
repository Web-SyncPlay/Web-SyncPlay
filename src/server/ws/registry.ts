import type { SessionKind } from "@/zod/types"
import type { WebSocket } from "ws"

export type SocketMeta = {
  roomId: string
  userId: string
  presenceTracked: boolean
  controlAuthorized: boolean
  isControlSession: boolean
  sessionKind: SessionKind
}

type RegistrySlot = {
  rooms: Map<string, Set<WebSocket>>
  sockets: Map<WebSocket, SocketMeta>
}

function getRegistrySlot() {
  const g = globalThis as typeof globalThis & {
    __webSyncPlayWsRegistry?: RegistrySlot
  }
  if (!g.__webSyncPlayWsRegistry) {
    g.__webSyncPlayWsRegistry = {
      rooms: new Map(),
      sockets: new Map(),
    }
  }

  return g.__webSyncPlayWsRegistry
}

export function addSocket(
  ws: WebSocket,
  meta: Omit<SocketMeta, "presenceTracked">,
) {
  const { rooms, sockets } = getRegistrySlot()
  const previousMeta = sockets.get(ws)
  if (previousMeta) {
    const previousRoomSet = rooms.get(previousMeta.roomId)
    previousRoomSet?.delete(ws)
    if (previousRoomSet && previousRoomSet.size === 0) {
      rooms.delete(previousMeta.roomId)
    }
  }

  const roomSet = rooms.get(meta.roomId) ?? new Set<WebSocket>()
  roomSet.add(ws)
  rooms.set(meta.roomId, roomSet)
  sockets.set(ws, {
    roomId: meta.roomId,
    userId: meta.userId,
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
  const { sockets } = getRegistrySlot()
  const meta = sockets.get(ws)
  if (!meta) {
    return
  }
  sockets.set(ws, { ...meta, presenceTracked })
}

export function setSocketControlAuthorized(
  ws: WebSocket,
  controlAuthorized: boolean,
) {
  const { sockets } = getRegistrySlot()
  const meta = sockets.get(ws)
  if (!meta) {
    return
  }
  sockets.set(ws, { ...meta, controlAuthorized })
}

export function removeSocket(ws: WebSocket) {
  const { rooms, sockets } = getRegistrySlot()
  const meta = sockets.get(ws)
  if (!meta) {
    return undefined
  }
  sockets.delete(ws)
  const roomSet = rooms.get(meta.roomId)
  roomSet?.delete(ws)
  if (roomSet && roomSet.size === 0) {
    rooms.delete(meta.roomId)
  }
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
