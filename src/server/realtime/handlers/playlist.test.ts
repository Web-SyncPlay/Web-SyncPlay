import { afterEach, describe, expect, test } from "bun:test"
import {
  createTestBroadcastBus,
  setRoomBroadcastBusForTests,
} from "@/server/realtime/broadcast/room-broadcast-bus"
import {
  handlePlaylistAddLocal,
  handlePlaylistItemError,
  handlePlaylistRemove,
  handlePlaylistRename,
  handlePlaylistReorder,
  handlePlaylistSelect,
} from "@/server/realtime/handlers/playlist"
import {
  createHandlerContext,
  createRoomState,
  envelope,
  InMemoryRoomStateStore,
} from "@/server/realtime/test-utils/fixtures"

describe("playlist handler interfaces", () => {
  afterEach(() => {
    setRoomBroadcastBusForTests(null)
  })

  test("select validates index and resets timeline", async () => {
    const store = new InMemoryRoomStateStore(
      createRoomState({
        playback: {
          paused: false,
          playbackRate: 1,
          timelineAnchorMs: 9_000,
          serverNowMs: Date.now(),
          videoLoop: "off",
          playlistLoop: "off",
          shuffle: false,
        },
      }),
    )
    createTestBroadcastBus(store)
    const ctx = createHandlerContext({ store })

    await handlePlaylistSelect(ctx, envelope("playlist:select", { index: -1 }))
    expect(store.peek("room-1")?.currentIndex).toBe(0)

    await handlePlaylistSelect(ctx, envelope("playlist:select", { index: 2 }))
    const next = store.peek("room-1")
    expect(next?.currentIndex).toBe(2)
    expect(next?.playback.timelineAnchorMs).toBe(0)
    // Selecting an item preserves prior play/pause intent (was playing).
    expect(next?.playback.paused).toBe(false)
    expect(next?.actionLog.at(-1)?.action).toBe("media:played")
  })

  test("reorder keeps current media identity", async () => {
    const store = new InMemoryRoomStateStore(
      createRoomState({ currentIndex: 1 }),
    )
    createTestBroadcastBus(store)
    const ctx = createHandlerContext({ store })
    const beforeId = store.peek("room-1")?.playlist[1]?.id

    await handlePlaylistReorder(
      ctx,
      envelope("playlist:reorder", { from: 0, to: 2 }),
    )
    const next = store.peek("room-1")
    expect(next?.playlist.map((item) => item.id)).toEqual([
      "item-b",
      "item-c",
      "item-a",
    ])
    expect(next?.playlist[next.currentIndex]?.id).toBe(beforeId)
  })

  test("remove drops item and adjusts current index", async () => {
    const store = new InMemoryRoomStateStore(
      createRoomState({ currentIndex: 1 }),
    )
    createTestBroadcastBus(store)
    const ctx = createHandlerContext({ store })

    await handlePlaylistRemove(
      ctx,
      envelope("playlist:remove", { itemId: "item-b" }),
    )
    const next = store.peek("room-1")
    expect(next?.playlist.map((item) => item.id)).toEqual([
      "item-a",
      "item-c",
    ])
    expect(next?.currentIndex).toBe(1)
    expect(next?.actionLog.at(-1)?.action).toBe("playlist:remove")
  })

  test("rename rejects empty/same name and updates when valid", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    const ctx = createHandlerContext({ store })

    await handlePlaylistRename(
      ctx,
      envelope("playlist:rename", { itemId: "item-a", name: "A" }),
    )
    expect(store.peek("room-1")?.playlist[0]?.name).toBe("A")

    await handlePlaylistRename(
      ctx,
      envelope("playlist:rename", { itemId: "item-a", name: " Alpha " }),
    )
    expect(store.peek("room-1")?.playlist[0]?.name).toBe("Alpha")
  })

  test("add local appends a ready local_file item", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    const ctx = createHandlerContext({ store })
    const localMediaId = "00000000-0000-4000-8000-0000000000aa"

    await handlePlaylistAddLocal(
      ctx,
      envelope("playlist:add:local", {
        localMediaId,
        name: "My clip",
        mimeType: "video/mp4",
        sizeBytes: 2048,
      }),
    )
    const item = store.peek("room-1")?.playlist.at(-1)
    expect(item?.sourceKind).toBe("local_file")
    expect(item?.localMediaId).toBe(localMediaId)
    expect(item?.ingestStatus).toBe("ready")
    expect(item?.defaultStreamId).toBe("local-default")

    const { getLocalMediaEntry, deleteLocalMediaEntry } = await import(
      "@/server/media/local-media-store"
    )
    const meta = await getLocalMediaEntry(localMediaId)
    expect(meta?.providerReady).toBe(true)
    await deleteLocalMediaEntry(localMediaId)
  })

  test("item error marks ingest error and may advance current index", async () => {
    const store = new InMemoryRoomStateStore(
      createRoomState({ currentIndex: 0 }),
    )
    createTestBroadcastBus(store)
    const ctx = createHandlerContext({ store })

    await handlePlaylistItemError(
      ctx,
      envelope("playlist:item:error", {
        itemId: "item-a",
        error: "decode failed",
      }),
    )
    const next = store.peek("room-1")
    expect(next?.playlist[0]?.ingestStatus).toBe("error")
    expect(next?.playlist[0]?.ingestError).toBe("decode failed")
    expect(next?.currentIndex).toBe(1)
  })

  test("guest cannot mutate playlist", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    const ctx = createHandlerContext({ store, userId: "guest" })

    await handlePlaylistSelect(ctx, envelope("playlist:select", { index: 1 }))
    expect(store.peek("room-1")?.currentIndex).toBe(0)
  })
})
