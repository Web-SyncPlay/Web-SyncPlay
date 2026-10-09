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
  /** Client IP captured at upgrade time (for join rate limits). */
  clientIp?: string
}

type RegistrySlot = {
  rooms: Map<string, Set<WebSocket>>
  sockets: Map<WebSocket, SocketMeta>
  /** IP stashed before `addSocket` (upgrade / early connection). */
  earlyClientIps: WeakMap<WebSocket, string>
}

function getRegistrySlot(): RegistrySlot {
  const g = globalThis as typeof globalThis & {
    __webSyncPlayWsRegistry?: RegistrySlot
  }
  g.__webSyncPlayWsRegistry ??= {
    rooms: new Map(),
    sockets: new Map(),
    earlyClientIps: new WeakMap(),
  }
  // Migrate hot-reload slots that predate earlyClientIps.
  g.__webSyncPlayWsRegistry.earlyClientIps ??= new WeakMap()
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
  patch: Partial<
    Pick<SocketMeta, "presenceTracked" | "controlAuthorized" | "clientIp">
  >,
) {
  const { sockets } = getRegistrySlot()
  const meta = sockets.get(ws)
  if (!meta) return
  sockets.set(ws, { ...meta, ...patch })
}

/**
 * Stash client IP as early as possible (WS upgrade / connection).
 * Survives until `addSocket` copies it onto full socket meta.
 */
export function setSocketClientIp(ws: WebSocket, clientIp: string) {
  const { earlyClientIps } = getRegistrySlot()
  earlyClientIps.set(ws, clientIp)
  patchSocketMeta(ws, { clientIp })
}

/** Best-effort IP for rate keys; falls back to `"unknown"`. */
export function getSocketClientIp(ws: WebSocket): string {
  const { earlyClientIps } = getRegistrySlot()
  return (
    getSocketMeta(ws)?.clientIp ?? earlyClientIps.get(ws) ?? "unknown"
  )
}

export function addSocket(
  ws: WebSocket,
  meta: Omit<SocketMeta, "presenceTracked" | "connectionId" | "clientIp"> & {
    clientIp?: string
  },
) {
  const { rooms, sockets, earlyClientIps } = getRegistrySlot()
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
    clientIp:
      meta.clientIp ??
      previousMeta?.clientIp ??
      earlyClientIps.get(ws),
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

/** All connected sockets across rooms (e.g. process-wide SFU invalidate). */
export function getAllSockets() {
  return getRegistrySlot().sockets.keys()
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
