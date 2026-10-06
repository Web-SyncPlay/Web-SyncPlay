import { expect, test } from "bun:test"
import type { WebSocket } from "ws"
import {
  addSocket,
  getSocketMeta,
  getSocketsForUser,
  removeSocket,
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
  const removed = removeSocket(ws)
  expect(removed?.presenceTracked).toBe(true)
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
