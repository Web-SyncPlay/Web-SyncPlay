import { afterAll, afterEach, describe, expect, mock, test } from "bun:test"
import { WebSocket } from "ws"
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
import { getSocketMeta, removeSocket } from "@/server/ws/registry"

mock.module("@/server/redis/client", () => ({
  getCommandClient: async () => ({
    del: async () => 1,
    sRem: async () => 1,
    sAdd: async () => 1,
    set: async () => "OK",
    expire: async () => true,
  }),
}))

const { postCommitJoinSideEffects } = await import("./post-commit")

afterAll(() => {
  mock.restore()
})

function committedState() {
  return createRoomState({
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
        username: "Guest",
      }),
    },
    generation: 1,
    structuralRevision: 1,
  })
}

function baseInput(
  store: InMemoryRoomStateStore,
  ws: ReturnType<typeof createFakeWs>["ws"],
  overrides: Partial<Parameters<typeof postCommitJoinSideEffects>[0]> = {},
) {
  return {
    ws,
    store,
    roomId: "room-1",
    userId: "guest",
    controlAuthorized: false,
    isControlSession: false,
    sessionKind: "room" as const,
    isPresenceAlreadyTracked: false,
    committed: committedState(),
    sessionCapabilities: {
      canControlPlayback: false,
      canManagePlaylist: false,
      canManageRoomSecurity: false,
      isControlSession: false,
      controlAuthorized: false,
      sessionKind: "room" as const,
    },
    reconnectingUserIds: [] as string[],
    disconnectingUserIds: [] as string[],
    requestId: "req-post-1",
    ...overrides,
  }
}

describe("postCommitJoinSideEffects (R2/R3 membership timing)", () => {
  afterEach(() => {
    setRoomBroadcastBusForTests(null)
  })

  test("R2/R3: registers socket then presence then joinCommitted", async () => {
    const store = new InMemoryRoomStateStore(committedState())
    store.presence.set(
      "room-1",
      new Map([["owner", { [getAppNodeId()]: 1 }]]),
    )
    createTestBroadcastBus(store)
    const { ws, sent } = createFakeWs()

    const joinCommittedAtPresence: boolean[] = []
    const originalAdd = store.addWsConnectionRef.bind(store)
    store.addWsConnectionRef = async (roomId, userId) => {
      // R3: flag must still be false while presence is being added.
      joinCommittedAtPresence.push(
        getSocketMeta(ws)?.joinCommitted === true,
      )
      expect(getSocketMeta(ws)).toMatchObject({
        roomId: "room-1",
        userId: "guest",
        joinCommitted: false,
      })
      await originalAdd(roomId, userId)
    }

    // R2: no registry membership before post-commit.
    expect(getSocketMeta(ws)).toBeUndefined()

    await postCommitJoinSideEffects(baseInput(store, ws))

    expect(joinCommittedAtPresence).toEqual([false])
    expect(getSocketMeta(ws)?.joinCommitted).toBe(true)
    expect(getSocketMeta(ws)?.presenceTracked).toBe(true)
    expect(
      totalPresenceRefs(store.presence.get("room-1")?.get("guest") ?? {}),
    ).toBe(1)
    expect(
      sent.some((m) => (m as { type?: string }).type === "room:snapshot"),
    ).toBe(true)
    expect(
      sent.some(
        (m) => (m as { type?: string }).type === "session:capabilities",
      ),
    ).toBe(true)

    removeSocket(ws)
  })

  test("R2: skips new presence ref when already tracked (same-socket rejoin)", async () => {
    const store = new InMemoryRoomStateStore(committedState())
    // Constructor already seeded one ref for connected guest — rejoin must not bump.
    const refsBefore = totalPresenceRefs(
      store.presence.get("room-1")?.get("guest") ?? {},
    )
    expect(refsBefore).toBe(1)
    createTestBroadcastBus(store)
    const { ws } = createFakeWs()
    let addCalls = 0
    const originalAdd = store.addWsConnectionRef.bind(store)
    store.addWsConnectionRef = async (roomId, userId) => {
      addCalls += 1
      await originalAdd(roomId, userId)
    }

    await postCommitJoinSideEffects(
      baseInput(store, ws, { isPresenceAlreadyTracked: true }),
    )

    expect(addCalls).toBe(0)
    expect(getSocketMeta(ws)?.joinCommitted).toBe(true)
    // PresenceTracked stays false here; join.ts tracks via pre-cleanup meta.
    expect(getSocketMeta(ws)?.presenceTracked).toBe(false)
    expect(
      totalPresenceRefs(store.presence.get("room-1")?.get("guest") ?? {}),
    ).toBe(refsBefore)

    removeSocket(ws)
  })

  test("aborts before membership when socket already closed (R1)", async () => {
    const store = new InMemoryRoomStateStore(committedState())
    store.presence.set(
      "room-1",
      new Map([["owner", { [getAppNodeId()]: 1 }]]),
    )
    createTestBroadcastBus(store)
    const { ws, sent } = createFakeWs()
    ws.close()
    expect(ws.readyState).toBe(WebSocket.CLOSED)

    await postCommitJoinSideEffects(baseInput(store, ws))

    expect(sent).toContainEqual({
      type: "room:join:rejected",
      requestId: "req-post-1",
      payload: { reason: "connection_closed" },
    })
    expect(getSocketMeta(ws)).toBeUndefined()
    expect(store.presence.get("room-1")?.has("guest")).toBe(false)
    expect(store.peek("room-1")?.participants.guest?.connected).toBe(false)
    expect(
      sent.some((m) => (m as { type?: string }).type === "room:snapshot"),
    ).toBe(false)
  })

  test("aborts after presence add when socket closes mid post-commit (D3)", async () => {
    const store = new InMemoryRoomStateStore(committedState())
    store.presence.set(
      "room-1",
      new Map([["owner", { [getAppNodeId()]: 1 }]]),
    )
    createTestBroadcastBus(store)
    const { ws, sent } = createFakeWs()

    const originalAdd = store.addWsConnectionRef.bind(store)
    store.addWsConnectionRef = async (roomId, userId) => {
      await originalAdd(roomId, userId)
      ws.close()
      removeSocket(ws)
    }

    await postCommitJoinSideEffects(baseInput(store, ws))

    expect(sent).toContainEqual({
      type: "room:join:rejected",
      requestId: "req-post-1",
      payload: { reason: "connection_closed" },
    })
    expect(getSocketMeta(ws)).toBeUndefined()
    expect(store.presence.get("room-1")?.has("guest")).toBe(false)
    expect(store.peek("room-1")?.participants.guest?.connected).toBe(false)
    expect(
      sent.some((m) => (m as { type?: string }).type === "room:snapshot"),
    ).toBe(false)
  })
})
