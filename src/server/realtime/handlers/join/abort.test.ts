import { afterAll, afterEach, describe, expect, mock, test } from "bun:test"
import {
  createTestBroadcastBus,
  setRoomBroadcastBusForTests,
} from "@/server/realtime/broadcast/room-broadcast-bus"
import { getAppNodeId } from "@/server/node-id"
import {
  createFakeWs,
  createParticipant,
  createRoomState,
  InMemoryRoomStateStore,
} from "@/server/realtime/test-utils/fixtures"
import { totalPresenceRefs } from "@/server/redis/presence-ref"
import {
  addSocket,
  getSocketMeta,
  removeSocket,
} from "@/server/ws/registry"

mock.module("@/server/redis/client", () => ({
  getCommandClient: async () => ({
    del: async () => 1,
    sRem: async () => 1,
    sAdd: async () => 1,
    set: async () => "OK",
    expire: async () => true,
  }),
}))

const { abortJoinAfterCommit } = await import("./abort")

afterAll(() => {
  mock.restore()
})

describe("abortJoinAfterCommit", () => {
  afterEach(() => {
    setRoomBroadcastBusForTests(null)
  })

  test("rejects with connection_closed and clears registry meta", async () => {
    const store = new InMemoryRoomStateStore(
      createRoomState({
        participants: {
          owner: createParticipant({ userId: "owner", role: "owner" }),
          guest: createParticipant({
            userId: "guest",
            role: "guest",
            connected: true,
          }),
        },
      }),
    )
    createTestBroadcastBus(store)
    const { ws, sent } = createFakeWs()
    addSocket(ws, {
      roomId: "room-1",
      userId: "guest",
      controlAuthorized: false,
      isControlSession: false,
      sessionKind: "room",
    })

    await abortJoinAfterCommit({
      ws,
      store,
      roomId: "room-1",
      userId: "guest",
      requestId: "req-abort-1",
      didAddPresence: false,
    })

    expect(sent).toContainEqual({
      type: "room:join:rejected",
      requestId: "req-abort-1",
      payload: { reason: "connection_closed" },
    })
    expect(getSocketMeta(ws)).toBeUndefined()
  })

  test("H2: marks participant offline when no live presence remains", async () => {
    const store = new InMemoryRoomStateStore(
      createRoomState({
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
      }),
    )
    // Commit wrote connected:true but this join never got a presence ref.
    store.presence.set(
      "room-1",
      new Map([["owner", { [getAppNodeId()]: 1 }]]),
    )
    createTestBroadcastBus(store)
    const { ws, sent } = createFakeWs()

    await abortJoinAfterCommit({
      ws,
      store,
      roomId: "room-1",
      userId: "guest",
      requestId: "req-abort-2",
      didAddPresence: false,
    })

    expect(sent).toContainEqual({
      type: "room:join:rejected",
      requestId: "req-abort-2",
      payload: { reason: "connection_closed" },
    })
    expect(store.peek("room-1")?.participants.guest?.connected).toBe(false)
    expect(store.peek("room-1")?.participants.guest?.disconnectedAt).toBeDefined()
    expect(
      store.peek("room-1")?.actionLog.some(
        (e) => e.action === "participant:disconnected",
      ),
    ).toBe(true)
  })

  test("decrements only this join's presence ref (didAddPresence)", async () => {
    const store = new InMemoryRoomStateStore(
      createRoomState({
        participants: {
          owner: createParticipant({ userId: "owner", role: "owner" }),
          guest: createParticipant({
            userId: "guest",
            role: "guest",
            connected: true,
          }),
        },
      }),
    )
    // Constructor seeds connected users; isolate a single ref for this join.
    store.presence.set(
      "room-1",
      new Map([["guest", { [getAppNodeId()]: 1 }]]),
    )
    expect(
      totalPresenceRefs(store.presence.get("room-1")?.get("guest") ?? {}),
    ).toBe(1)
    createTestBroadcastBus(store)
    const { ws } = createFakeWs()
    addSocket(ws, {
      roomId: "room-1",
      userId: "guest",
      controlAuthorized: false,
      isControlSession: false,
      sessionKind: "room",
    })

    await abortJoinAfterCommit({
      ws,
      store,
      roomId: "room-1",
      userId: "guest",
      didAddPresence: true,
    })

    expect(store.presence.get("room-1")?.has("guest")).toBe(false)
    expect(store.peek("room-1")?.participants.guest?.connected).toBe(false)
  })

  test("H1: keeps other tab/node refs and does not mark offline", async () => {
    const otherNodeId = "other-node"
    const store = new InMemoryRoomStateStore(
      createRoomState({
        participants: {
          owner: createParticipant({ userId: "owner", role: "owner" }),
          guest: createParticipant({
            userId: "guest",
            role: "guest",
            connected: true,
          }),
        },
      }),
    )
    store.presence.set(
      "room-1",
      new Map([
        [
          "guest",
          { [otherNodeId]: 1, [getAppNodeId()]: 1 },
        ],
      ]),
    )
    store.aliveNodeIds = new Set([getAppNodeId(), otherNodeId])
    createTestBroadcastBus(store)
    const { ws } = createFakeWs()
    addSocket(ws, {
      roomId: "room-1",
      userId: "guest",
      controlAuthorized: false,
      isControlSession: false,
      sessionKind: "room",
    })

    await abortJoinAfterCommit({
      ws,
      store,
      roomId: "room-1",
      userId: "guest",
      didAddPresence: true,
    })

    const guestRefs = store.presence.get("room-1")?.get("guest") ?? {}
    expect(guestRefs[otherNodeId]).toBe(1)
    expect(guestRefs[getAppNodeId()]).toBeUndefined()
    expect(totalPresenceRefs(guestRefs)).toBe(1)
    expect((await store.getWsPresenceUserIds("room-1")).has("guest")).toBe(true)
    expect(store.peek("room-1")?.participants.guest?.connected).toBe(true)

    removeSocket(ws)
  })
})
