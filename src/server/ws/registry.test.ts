import { expect, test } from "bun:test"
import type { WebSocket } from "ws"
import {
  addSocket,
  getSocketClientIp,
  getSocketMeta,
  getSocketsForUser,
  removeSocket,
  setSocketClientIp,
  setSocketControlAuthorized,
  setSocketPresenceTracked,
} from "./registry"

function createWs() {
  return {} as WebSocket
}

test("preserves presenceTracked for duplicate joins on same socket", () => {
  const ws = createWs()
  addSocket(ws, {
    roomId: "room-1",
    userId: "u1",
    controlAuthorized: false,
    isControlSession: false,
    sessionKind: "room",
  })
  setSocketPresenceTracked(ws, true)

  addSocket(ws, {
    roomId: "room-1",
    userId: "u1",
    controlAuthorized: false,
    isControlSession: false,
    sessionKind: "room",
  })
  const meta = getSocketMeta(ws)

  expect(meta?.presenceTracked).toBe(true)
  expect(typeof meta?.connectionId).toBe("string")
  expect(meta?.connectionId.length).toBeGreaterThan(0)
  const connectionId = meta?.connectionId
  const removed = removeSocket(ws)
  expect(removed?.presenceTracked).toBe(true)
  expect(removed?.connectionId).toBe(connectionId)
})

test("preserves connectionId for duplicate joins on same socket", () => {
  const ws = createWs()
  addSocket(ws, {
    roomId: "room-1",
    userId: "u1",
    controlAuthorized: false,
    isControlSession: false,
    sessionKind: "room",
  })
  const firstId = getSocketMeta(ws)?.connectionId
  addSocket(ws, {
    roomId: "room-1",
    userId: "u1",
    controlAuthorized: false,
    isControlSession: false,
    sessionKind: "player",
  })
  expect(getSocketMeta(ws)?.connectionId).toBe(firstId)
  removeSocket(ws)
})

test("replacing room metadata on same socket updates room/user", () => {
  const ws = createWs()
  addSocket(ws, {
    roomId: "room-1",
    userId: "u1",
    controlAuthorized: false,
    isControlSession: false,
    sessionKind: "room",
  })
  addSocket(ws, {
    roomId: "room-2",
    userId: "u2",
    controlAuthorized: true,
    isControlSession: true,
    sessionKind: "control",
  })
  const meta = getSocketMeta(ws)

  expect(meta?.roomId).toBe("room-2")
  expect(meta?.userId).toBe("u2")
  expect(meta?.controlAuthorized).toBe(true)
  expect(meta?.isControlSession).toBe(true)
  expect(meta?.sessionKind).toBe("control")

  removeSocket(ws)
})

test("setSocketControlAuthorized patches without dropping other meta", () => {
  const ws = createWs()
  addSocket(ws, {
    roomId: "room-1",
    userId: "u1",
    controlAuthorized: false,
    isControlSession: false,
    sessionKind: "room",
  })
  setSocketPresenceTracked(ws, true)
  setSocketControlAuthorized(ws, true)

  const meta = getSocketMeta(ws)
  expect(meta?.controlAuthorized).toBe(true)
  expect(meta?.presenceTracked).toBe(true)
  expect(meta?.roomId).toBe("room-1")
  removeSocket(ws)
})

test("getSocketsForUser returns sockets for matching room+user", () => {
  const wsA = createWs()
  const wsB = createWs()
  addSocket(wsA, {
    roomId: "room-1",
    userId: "u1",
    controlAuthorized: false,
    isControlSession: false,
    sessionKind: "room",
  })
  addSocket(wsB, {
    roomId: "room-1",
    userId: "u2",
    controlAuthorized: false,
    isControlSession: false,
    sessionKind: "room",
  })

  expect(getSocketsForUser("room-1", "u1")).toEqual([wsA])
  expect(getSocketsForUser("room-1", "u2")).toEqual([wsB])
  expect(getSocketsForUser("room-1", "missing")).toEqual([])

  removeSocket(wsA)
  removeSocket(wsB)
})

test("setSocketClientIp stashes early and survives addSocket", () => {
  const ws = createWs()
  expect(getSocketClientIp(ws)).toBe("unknown")

  setSocketClientIp(ws, "203.0.113.50")
  expect(getSocketClientIp(ws)).toBe("203.0.113.50")
  expect(getSocketMeta(ws)).toBeUndefined()

  addSocket(ws, {
    roomId: "room-1",
    userId: "u1",
    controlAuthorized: false,
    isControlSession: false,
    sessionKind: "room",
  })
  expect(getSocketClientIp(ws)).toBe("203.0.113.50")
  expect(getSocketMeta(ws)?.clientIp).toBe("203.0.113.50")

  removeSocket(ws)
})
