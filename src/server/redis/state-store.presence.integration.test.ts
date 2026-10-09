/**
 * Valkey-backed presence bump / clear tests (finding T1).
 * Skips when VALKEY_URL is unset (local without Redis).
 */

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test"
import { getAppNodeId } from "@/server/node-id"

const hasValkey = Boolean(process.env.VALKEY_URL?.trim())

describe.skipIf(!hasValkey)("state-store presence (Valkey)", () => {
  let store: Awaited<
    ReturnType<typeof import("./state-store").getRoomStateStore>
  >
  const roomId = `test-presence-${Date.now()}`
  const userId = "presence-user-1"

  beforeAll(async () => {
    // Prior unit files may mock redis; restore before talking to real Valkey.
    mock.restore()
    const clientMod = await import("./client")
    await clientMod.shutdownRedis?.().catch(() => {})
    const mod = await import("./state-store")
    store = await mod.getRoomStateStore()
  })

  afterAll(async () => {
    try {
      await store.clearWsConnectionRef(roomId, userId)
      await store.delete(roomId)
    } catch {
      /* ignore cleanup errors */
    }
  })

  test("add/remove presence ref updates alive user set", async () => {
    await store.clearWsConnectionRef(roomId, userId)
    let alive = await store.getWsPresenceUserIds(roomId)
    expect(alive.has(userId)).toBe(false)

    await store.addWsConnectionRef(roomId, userId)
    alive = await store.getWsPresenceUserIds(roomId)
    expect(alive.has(userId)).toBe(true)

    await store.removeWsConnectionRef(roomId, userId)
    alive = await store.getWsPresenceUserIds(roomId)
    expect(alive.has(userId)).toBe(false)
  })

  test("clearWsConnectionRef drops this node’s refs", async () => {
    await store.addWsConnectionRef(roomId, userId)
    await store.addWsConnectionRef(roomId, userId)
    await store.clearWsConnectionRef(roomId, userId)
    const alive = await store.getWsPresenceUserIds(roomId)
    expect(alive.has(userId)).toBe(false)
    expect(getAppNodeId()).toBeTruthy()
  })
})
