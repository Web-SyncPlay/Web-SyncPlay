import assert from "node:assert/strict"
import test from "node:test"
import type { WebSocket } from "ws"
import {
  addSocket,
  getSocketMeta,
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

  assert.equal(meta?.presenceTracked, true)
  const removed = removeSocket(ws)
  assert.equal(removed?.presenceTracked, true)
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

  assert.equal(meta?.roomId, "room-2")
  assert.equal(meta?.userId, "u2")
  assert.equal(meta?.controlAuthorized, true)
  assert.equal(meta?.isControlSession, true)
  assert.equal(meta?.sessionKind, "control")

  removeSocket(ws)
})
