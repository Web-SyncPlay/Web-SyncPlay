import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  createTestBroadcastBus,
  setRoomBroadcastBusForTests,
} from "@/server/realtime/broadcast/room-broadcast-bus"
import {
  createRoomState,
  InMemoryRoomStateStore,
} from "@/server/realtime/test-utils/fixtures"

afterEach(() => {
  mock.restore()
  setRoomBroadcastBusForTests(null)
})

describe("processDuePrunes", () => {
  test("returns null from mutate when participant already gone (no spurious SET)", async () => {
    mock.module("@/server/redis/client", () => ({
      getCommandClient: async () => ({
        sMembers: async () => ["room-1\tmissing-user"],
        get: async () => null,
        sRem: async () => 1,
        expire: async () => 1,
      }),
    }))

    const { processDuePrunes } = await import("./participants")
    const store = new InMemoryRoomStateStore(createRoomState())
    let writes = 0
    const originalUpdate = store.updateRoom.bind(store)
    store.updateRoom = async (roomId, mutate) => {
      const next = await originalUpdate(roomId, async (state) => {
        const result = await mutate(state)
        if (result !== null) writes += 1
        return result
      })
      return next
    }

    const pruned = await processDuePrunes(store)
    expect(pruned).toBe(0)
    expect(writes).toBe(0)
  })

  test("deletes disconnected participant when grace expired", async () => {
    mock.module("@/server/redis/client", () => ({
      getCommandClient: async () => ({
        sMembers: async () => ["room-1\tguest"],
        get: async () => null,
        sRem: async () => 1,
        expire: async () => 1,
      }),
    }))

    const { processDuePrunes } = await import("./participants")
    const state = createRoomState()
    state.participants.guest!.connected = false
    state.participants.guest!.disconnectedAt = Date.now() - 120_000
    const store = new InMemoryRoomStateStore(state)

    const pruned = await processDuePrunes(store)
    expect(pruned).toBe(1)
    expect(store.peek("room-1")?.participants.guest).toBeUndefined()
  })

  test("transfers ownership when the disconnected owner is pruned", async () => {
    mock.module("@/server/redis/client", () => ({
      getCommandClient: async () => ({
        sMembers: async () => ["room-1\towner"],
        get: async () => null,
        sRem: async () => 1,
        expire: async () => 1,
      }),
    }))

    const { processDuePrunes } = await import("./participants")
    const state = createRoomState()
    state.participants.owner!.connected = false
    state.participants.owner!.disconnectedAt = Date.now() - 120_000
    state.participants.guest!.connected = false
    state.participants.mod!.connected = true
    state.generation = 3
    state.structuralRevision = 7
    const store = new InMemoryRoomStateStore(state)
    createTestBroadcastBus(store)

    const pruned = await processDuePrunes(store)
    expect(pruned).toBe(1)
    const next = store.peek("room-1")
    expect(next?.participants.owner).toBeUndefined()
    expect(next?.ownerId).toBe("mod")
    expect(next?.participants.mod?.role).toBe("owner")
    expect(next?.generation).toBe(4)
    expect(next?.structuralRevision).toBe(8)
    expect(
      next?.actionLog.some(
        (e) =>
          e.action === "participant:owner:transferred" &&
          (e.payload as { reason?: string }).reason === "prune",
      ),
    ).toBe(true)
  })
})
