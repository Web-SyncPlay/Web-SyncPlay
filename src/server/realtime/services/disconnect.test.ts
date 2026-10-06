import { afterEach, describe, expect, test } from "bun:test"
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
        shuffle: false,
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

  test("handleSocketDisconnect deletes empty rooms", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    store.presence.set("room-1", new Map())

    await handleSocketDisconnect(store, {
      roomId: "room-1",
      userId: "owner",
      presenceTracked: true,
    })

    expect(await store.get("room-1")).toBeNull()
  })

  test("handleSocketDisconnect no-ops when user still has another connection", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    // Owner has two sockets (refcount 2); closing one must leave them online.
    store.presence.set(
      "room-1",
      new Map([
        ["owner", 2],
        ["guest", 1],
      ]),
    )

    await handleSocketDisconnect(store, {
      roomId: "room-1",
      userId: "owner",
      presenceTracked: true,
    })

    expect(store.peek("room-1")?.participants.owner?.connected).toBe(true)
    expect(store.presence.get("room-1")?.get("owner")).toBe(1)
  })
})
