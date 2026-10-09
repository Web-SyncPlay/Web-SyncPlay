import { afterEach, describe, expect, test } from "bun:test"
import {
  createTestBroadcastBus,
  setRoomBroadcastBusForTests,
} from "@/server/realtime/broadcast/room-broadcast-bus"
import {
  createFakeWs,
  createRoomState,
  InMemoryRoomStateStore,
} from "@/server/realtime/test-utils/fixtures"
import { addSocket, removeSocket } from "@/server/ws/registry"

describe("RoomBroadcastBus", () => {
  afterEach(() => {
    setRoomBroadcastBusForTests(null)
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
    }
    expect(Object.keys(payload.participants).sort()).toEqual(["guest", "owner"])
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
