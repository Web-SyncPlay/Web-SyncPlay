import { afterEach, describe, expect, test } from "bun:test"
import {
  createTestBroadcastBus,
  setRoomBroadcastBusForTests,
} from "@/server/realtime/broadcast/room-broadcast-bus"
import { handleSeekPreview } from "@/server/realtime/handlers/seek-preview"
import {
  createHandlerContext,
  createRoomState,
  envelope,
  InMemoryRoomStateStore,
} from "@/server/realtime/test-utils/fixtures"

describe("seek preview handler", () => {
  afterEach(() => {
    setRoomBroadcastBusForTests(null)
  })

  test("controller publishes ephemeral control without room write", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    const bus = createTestBroadcastBus(store)
    const ctx = createHandlerContext({ store, userId: "owner" })

    await handleSeekPreview(
      ctx,
      envelope("seek:preview", { targetMs: 4_000, active: true }),
    )
    expect(store.peek("room-1")?.playback.seekPreview).toBeUndefined()
    expect(store.peek("room-1")?.playback.timelineAnchorMs).toBe(0)
    const control = bus.captured.find((c) => c.envelope.type === "room:control")
    expect(control).toBeDefined()
    const payload = control!.envelope.payload as {
      playback: { seekPreview?: { targetMs: number; active: boolean } }
    }
    expect(payload.playback.seekPreview).toMatchObject({
      targetMs: 4_000,
      active: true,
    })
  })

  test("active:false does not commit timeline (use playback:seek)", async () => {
    const store = new InMemoryRoomStateStore(
      createRoomState({
        playback: {
          paused: true,
          playbackRate: 1,
          timelineAnchorMs: 3_000,
          serverNowMs: Date.now(),
          videoLoop: "off",
          playlistLoop: "off",
        },
      }),
    )
    const bus = createTestBroadcastBus(store)
    const ctx = createHandlerContext({ store, userId: "owner" })

    await handleSeekPreview(
      ctx,
      envelope("seek:preview", { targetMs: 12_500, active: false }),
    )

    const next = store.peek("room-1")
    expect(next?.playback.timelineAnchorMs).toBe(3_000)
    expect(next?.playback.seekPreview).toBeUndefined()
    expect(next?.actionLog).toEqual([])
    expect(bus.captured.length).toBe(0)
  })

  test("guest cannot publish seek preview", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    const bus = createTestBroadcastBus(store)
    await handleSeekPreview(
      createHandlerContext({ store, userId: "guest" }),
      envelope("seek:preview", { targetMs: 4_000, active: true }),
    )
    expect(store.peek("room-1")?.playback.seekPreview).toBeUndefined()
    expect(bus.captured.length).toBe(0)
  })
})
