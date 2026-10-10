import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  createTestBroadcastBus,
  resetPresenceSeqFallbackForTests,
  setRoomBroadcastBusForTests,
} from "@/server/realtime/broadcast/room-broadcast-bus"
import {
  createFakeWs,
  createRoomState,
  InMemoryRoomStateStore,
} from "@/server/realtime/test-utils/fixtures"
import { addSocket, removeSocket } from "@/server/ws/registry"
import { keys } from "@/server/redis/keys"

describe("RoomBroadcastBus", () => {
  afterEach(() => {
    setRoomBroadcastBusForTests(null)
    resetPresenceSeqFallbackForTests()
    mock.restore()
  })

  test("coalesces N presence dirties into one flush", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    const bus = createTestBroadcastBus(store)
    // Use tiny interval via direct flush for determinism.
    bus.markPresenceDirty("room-1", "guest", {
      localPlayback: {
        paused: false,
        currentTimeMs: 100,
        loading: false,
        updatedAt: Date.now(),
      },
    })
    bus.markPresenceDirty("room-1", "guest", {
      localPlayback: {
        paused: false,
        currentTimeMs: 200,
        loading: false,
        updatedAt: Date.now(),
      },
    })
    bus.markPresenceDirty("room-1", "owner", {
      localPlayback: {
        paused: true,
        currentTimeMs: 0,
        loading: false,
        updatedAt: Date.now(),
      },
    })

    await bus.flushPresence("room-1")

    const presencePubs = bus.captured.filter(
      (c) => c.envelope.type === "presence:batch",
    )
    expect(presencePubs.length).toBe(1)
    const payload = presencePubs[0]!.envelope.payload as {
      participants: Record<string, unknown>
      presenceRevision: number
    }
    expect(Object.keys(payload.participants).sort()).toEqual(["guest", "owner"])
    expect(payload.presenceRevision).toBe(1)
  })

  test("shared Redis presenceSeq is monotonic across two logical nodes", async () => {
    const seq = new Map<string, number>()
    const expires = new Map<string, number>()
    mock.module("@/server/redis/client", () => ({
      getCommandClient: async () => ({
        incr: async (key: string) => {
          const next = (seq.get(key) ?? 0) + 1
          seq.set(key, next)
          return next
        },
        expire: async (key: string, ttl: number) => {
          expires.set(key, ttl)
          return true
        },
        publish: async () => 0,
      }),
    }))

    const { RoomBroadcastBus } = await import(
      "@/server/realtime/broadcast/room-broadcast-bus"
    )
    const store = new InMemoryRoomStateStore(createRoomState())
    // Two buses = two origins; neither uses captureOnly so both hit Redis INCR.
    const nodeA = new RoomBroadcastBus()
    const nodeB = new RoomBroadcastBus()
    nodeA.attachStore(store)
    nodeB.attachStore(store)

    const patch = {
      localPlayback: {
        paused: false,
        currentTimeMs: 1,
        loading: false,
        updatedAt: Date.now(),
      },
    }
    nodeA.markPresenceDirty("room-1", "guest", patch)
    await nodeA.flushPresence("room-1")
    nodeB.markPresenceDirty("room-1", "owner", patch)
    await nodeB.flushPresence("room-1")
    nodeA.markPresenceDirty("room-1", "guest", {
      ...patch,
      localPlayback: { ...patch.localPlayback, currentTimeMs: 2 },
    })
    await nodeA.flushPresence("room-1")

    const seqKey = keys.roomPresenceSeq("room-1")
    expect(seq.get(seqKey)).toBe(3)
    expect(expires.has(seqKey)).toBe(true)

    const revsA = nodeA.captured
      .filter((c) => c.envelope.type === "presence:batch")
      .map((c) => (c.envelope.payload as { presenceRevision: number }).presenceRevision)
    const revsB = nodeB.captured
      .filter((c) => c.envelope.type === "presence:batch")
      .map((c) => (c.envelope.payload as { presenceRevision: number }).presenceRevision)
    expect(revsA).toEqual([1, 3])
    expect(revsB).toEqual([2])
    // Independent local counters would collide at 1; shared seq stays strictly increasing.
    expect([...revsA, ...revsB].sort((a, b) => a - b)).toEqual([1, 2, 3])
  })

  test("publishControl is immediate and does not require snapshot", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    const bus = createTestBroadcastBus(store)
    const state = store.peek("room-1")!
    await bus.publishControl("room-1", bus.controlPayloadFromState(state))
    expect(bus.captured.some((c) => c.envelope.type === "room:control")).toBe(
      true,
    )
    expect(bus.captured.some((c) => c.envelope.type === "room:snapshot")).toBe(
      false,
    )
  })

  test("flushSnapshot skips republish when structural hash is unchanged", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    const bus = createTestBroadcastBus(store)
    await bus.flushSnapshot("room-1")
    await bus.flushSnapshot("room-1")
    const snapshots = bus.captured.filter(
      (c) => c.envelope.type === "room:snapshot",
    )
    expect(snapshots.length).toBe(1)
  })

  test("fanOutFromPubSub admission:changed kicks non-owners only", () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    const bus = createTestBroadcastBus(store)

    const owner = createFakeWs()
    const guest = createFakeWs()
    addSocket(owner.ws, {
      roomId: "room-1",
      userId: "owner",
      controlAuthorized: true,
      isControlSession: true,
      sessionKind: "room",
    })
    addSocket(guest.ws, {
      roomId: "room-1",
      userId: "guest",
      controlAuthorized: false,
      isControlSession: false,
      sessionKind: "room",
    })

    try {
      bus.fanOutFromPubSub("room-1", {
        type: "room:admission:changed",
        payload: {
          admissionVersion: 2,
          ownerId: "owner",
          joinPasswordEnabled: true,
        },
        originNodeId: "other-node",
      })
      expect(owner.closed).toBe(false)
      expect(guest.closed).toBe(true)
      expect(
        guest.sent.some(
          (m) => (m as { type?: string }).type === "room:admission:changed",
        ),
      ).toBe(true)
    } finally {
      removeSocket(owner.ws)
      removeSocket(guest.ws)
    }
  })
})
