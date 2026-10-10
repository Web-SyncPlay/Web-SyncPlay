import { afterEach, describe, expect, mock, test } from "bun:test"
import { getAppNodeId } from "@/server/node-id"
import {
  createTestBroadcastBus,
  setRoomBroadcastBusForTests,
} from "@/server/realtime/broadcast/room-broadcast-bus"
import {
  createParticipant,
  createRoomState,
  InMemoryRoomStateStore,
} from "@/server/realtime/test-utils/fixtures"

afterEach(() => {
  mock.restore()
  setRoomBroadcastBusForTests(null)
})

function roomWithOfflineGuest() {
  const state = createRoomState({
    participants: {
      owner: createParticipant({
        userId: "owner",
        role: "owner",
        connected: true,
      }),
      guest: createParticipant({
        userId: "guest",
        role: "guest",
        connected: true,
      }),
    },
  })
  const store = new InMemoryRoomStateStore(state)
  // Guest is "connected" in room state but has no WS presence → disconnecting.
  store.presence.set(
    "room-1",
    new Map([["owner", { [getAppNodeId()]: 1 }]]),
  )
  return store
}

describe("mutateRoomMessage presence prune scheduling", () => {
  test("does not schedulePrune when body aborts after reconcile", async () => {
    let pruneSetCalls = 0
    mock.module("@/server/redis/client", () => ({
      getCommandClient: async () => ({
        set: async () => {
          pruneSetCalls += 1
          return "OK"
        },
        sAdd: async () => 1,
        expire: async () => 1,
        del: async () => 1,
        sRem: async () => 1,
      }),
    }))

    const { mutateRoomMessage } = await import("./mutate-room")
    const store = roomWithOfflineGuest()
    createTestBroadcastBus(store)

    const result = await mutateRoomMessage(
      store,
      "room-1",
      "owner",
      () => false,
    )

    expect(result).toBeNull()
    expect(pruneSetCalls).toBe(0)
    // Aborted write must not persist in-memory disconnect marking.
    expect(store.peek("room-1")?.participants.guest?.connected).toBe(true)
  })

  test("schedules prune only after a successful room write", async () => {
    let pruneSetCalls = 0
    mock.module("@/server/redis/client", () => ({
      getCommandClient: async () => ({
        set: async () => {
          pruneSetCalls += 1
          return "OK"
        },
        sAdd: async () => 1,
        expire: async () => 1,
        del: async () => 1,
        sRem: async () => 1,
      }),
    }))

    const { mutateRoomMessage } = await import("./mutate-room")
    const store = roomWithOfflineGuest()
    createTestBroadcastBus(store)

    const result = await mutateRoomMessage(
      store,
      "room-1",
      "owner",
      () => true,
    )

    expect(result).not.toBeNull()
    expect(pruneSetCalls).toBe(1)
    expect(store.peek("room-1")?.participants.guest?.connected).toBe(false)
  })
})
