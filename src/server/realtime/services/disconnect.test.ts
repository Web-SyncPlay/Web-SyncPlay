import { afterEach, describe, expect, test } from "bun:test"
import { getAppNodeId } from "@/server/node-id"
import {
  createTestBroadcastBus,
  setRoomBroadcastBusForTests,
} from "@/server/realtime/broadcast/room-broadcast-bus"
import {
  applyUserWentOffline,
  handleSocketDisconnect,
} from "@/server/realtime/services/disconnect"
import {
  createPlaylistItem,
  createRoomState,
  InMemoryRoomStateStore,
} from "@/server/realtime/test-utils/fixtures"

describe("disconnect lifecycle", () => {
  afterEach(() => {
    setRoomBroadcastBusForTests(null)
  })
  test("applyUserWentOffline marks participant, invalidates local media, transfers ownership", () => {
    const state = createRoomState({
      playlist: [
        createPlaylistItem({
          id: "local-1",
          name: "Local",
          sourceKind: "local_file",
          localOriginUserId: "owner",
          localMediaId: "file-1",
        }),
      ],
      currentIndex: 0,
      playback: {
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 1000,
        serverNowMs: Date.now(),
        videoLoop: "off",
        playlistLoop: "off",
      },
    })

    const changed = applyUserWentOffline(state, "room-1", "owner")

    expect(changed).toBe(true)
    expect(state.participants.owner?.connected).toBe(false)
    expect(state.playlist[0]?.blockedReason).toBe("local_owner_offline")
    expect(state.playback.paused).toBe(true)
    expect(state.ownerId).toBe("mod")
    expect(
      state.actionLog.some((e) => e.action === "participant:disconnected"),
    ).toBe(true)
  })

  test("handleSocketDisconnect deletes empty rooms outside WATCH", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    store.presence.set("room-1", new Map())

    let deleteDuringMutate = false
    const originalUpdate = store.updateRoom.bind(store)
    store.updateRoom = async (roomId, mutate) => {
      const next = await originalUpdate(roomId, async (state) => {
        const result = await mutate(state)
        if (store.rooms.has(roomId) === false) {
          deleteDuringMutate = true
        }
        return result
      })
      return next
    }

    await handleSocketDisconnect(store, {
      roomId: "room-1",
      userId: "owner",
      connectionId: "conn-owner",
      presenceTracked: true,
    })

    expect(deleteDuringMutate).toBe(false)
    expect(await store.get("room-1")).toBeNull()
  })

  test("handleSocketDisconnect no-ops when user still has another connection", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    const nodeId = getAppNodeId()
    // Owner has two sockets (refcount 2); closing one must leave them online.
    store.presence.set(
      "room-1",
      new Map([
        ["owner", { [nodeId]: 2 }],
        ["guest", { [nodeId]: 1 }],
      ]),
    )
    await store.mergePresenceData("room-1", "owner", {
      localPlayback: {
        paused: false,
        currentTimeMs: 1000,
        loading: false,
        updatedAt: Date.now(),
      },
      localPlaybackReports: {
        "conn-room": {
          sessionKind: "room",
          paused: false,
          currentTimeMs: 1000,
          loading: true,
          updatedAt: Date.now(),
        },
        "conn-player": {
          sessionKind: "player",
          paused: false,
          currentTimeMs: 1000,
          loading: false,
          updatedAt: Date.now(),
        },
      },
    })

    await handleSocketDisconnect(store, {
      roomId: "room-1",
      userId: "owner",
      connectionId: "conn-room",
      presenceTracked: true,
    })

    expect(store.peek("room-1")?.participants.owner?.connected).toBe(true)
    expect(store.presence.get("room-1")?.get("owner")).toEqual({ [nodeId]: 1 })
    const presence = await store.getPresenceDataAll("room-1")
    expect(presence.owner?.localPlaybackReports?.["conn-room"]).toBeUndefined()
    expect(presence.owner?.localPlaybackReports?.["conn-player"]).toBeDefined()
    expect(presence.owner?.localPlayback?.loading).toBe(false)
  })

  test("does not call presence Redis I/O inside updateRoom mutate", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    const nodeId = getAppNodeId()
    store.presence.set(
      "room-1",
      new Map([
        ["owner", { [nodeId]: 1 }],
        ["guest", { [nodeId]: 1 }],
      ]),
    )

    let duringMutate = false
    const originalUpdate = store.updateRoom.bind(store)
    const originalRead = store.readWsPresenceUserIds.bind(store)
    const originalReconcile = store.reconcilePresenceRefs.bind(store)
    const originalGet = store.getWsPresenceUserIds.bind(store)

    store.readWsPresenceUserIds = async (roomId) => {
      if (duringMutate) {
        throw new Error("readWsPresenceUserIds called inside updateRoom mutate")
      }
      return originalRead(roomId)
    }
    store.reconcilePresenceRefs = async (roomId) => {
      if (duringMutate) {
        throw new Error("reconcilePresenceRefs called inside updateRoom mutate")
      }
      return originalReconcile(roomId)
    }
    store.getWsPresenceUserIds = async (roomId) => {
      if (duringMutate) {
        throw new Error("getWsPresenceUserIds called inside updateRoom mutate")
      }
      return originalGet(roomId)
    }
    store.updateRoom = async (roomId, mutate) => {
      duringMutate = true
      try {
        return await originalUpdate(roomId, mutate)
      } finally {
        duringMutate = false
      }
    }

    await handleSocketDisconnect(store, {
      roomId: "room-1",
      userId: "guest",
      connectionId: "conn-guest",
      presenceTracked: true,
    })

    expect(store.peek("room-1")?.participants.guest?.connected).toBe(false)
  })

  test("alive filtering ignores refs on dead remote nodes", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    const local = getAppNodeId()
    store.aliveNodeIds = new Set([local])
    store.presence.set(
      "room-1",
      new Map([
        ["owner", { [local]: 1 }],
        ["guest", { "dead-node": 1 }],
      ]),
    )

    await handleSocketDisconnect(store, {
      roomId: "room-1",
      userId: "guest",
      connectionId: "conn-guest",
      presenceTracked: false,
    })

    // guest only had a dead-node ref → treated offline; owner stays.
    expect(store.peek("room-1")?.participants.guest?.connected).toBe(false)
    expect(store.peek("room-1")?.participants.owner?.connected).toBe(true)
  })
})
