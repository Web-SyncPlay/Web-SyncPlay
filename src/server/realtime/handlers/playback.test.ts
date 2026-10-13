import {
  createTestBroadcastBus,
  setRoomBroadcastBusForTests,
} from "@/server/realtime/broadcast/room-broadcast-bus"
import {
  handlePlaybackLoopPlaylist,
  handlePlaybackLoopVideo,
  handlePlaybackPause,
  handlePlaybackPlay,
  handlePlaybackRate,
  handlePlaybackSeek,
} from "@/server/realtime/handlers/playback"
import { computeSessionCapabilities } from "@/server/realtime/services/permissions"
import {
  createFakeWs,
  createHandlerContext,
  createRoomState,
  envelope,
  InMemoryRoomStateStore,
} from "@/server/realtime/test-utils/fixtures"
import { afterEach, describe, expect, test } from "bun:test"

describe("playback handler interfaces", () => {
  afterEach(() => {
    setRoomBroadcastBusForTests(null)
  })

  test("seek updates timeline for owner and rejects invalid payload", async () => {
    const state = createRoomState()
    const store = new InMemoryRoomStateStore(state)
    createTestBroadcastBus(store)
    const ctx = createHandlerContext({ store, userId: "owner" })

    await handlePlaybackSeek(ctx, envelope("playback:seek", { targetMs: -1 }))
    expect(store.peek("room-1")?.playback.timelineAnchorMs).toBe(0)

    await handlePlaybackSeek(
      ctx,
      envelope("playback:seek", { targetMs: 12_000 }),
    )
    const next = store.peek("room-1")
    expect(next?.playback.timelineAnchorMs).toBe(12_000)
    expect(next?.playback.seekPreview).toBeUndefined()
    expect(next?.actionLog.at(-1)?.action).toBe("playback:seek")
  })

  test("play/pause toggle paused flag and ignore guest control", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    const ownerCtx = createHandlerContext({ store, userId: "owner" })
    const guestCtx = createHandlerContext({ store, userId: "guest" })

    await handlePlaybackPlay(
      guestCtx,
      envelope("playback:play", { currentTimeMs: 5_000 }),
    )
    expect(store.peek("room-1")?.playback.paused).toBe(true)

    await handlePlaybackPlay(
      ownerCtx,
      envelope("playback:play", { currentTimeMs: 5_000 }),
    )
    expect(store.peek("room-1")?.playback.paused).toBe(false)
    // Client currentTimeMs is ignored — anchor comes from server projection.
    expect(store.peek("room-1")?.playback.timelineAnchorMs).toBe(0)

    await handlePlaybackPause(ownerCtx, envelope("playback:pause", {}))
    expect(store.peek("room-1")?.playback.paused).toBe(true)
  })

  test("play/pause ignores skewed client currentTimeMs for the timeline", async () => {
    const initial = createRoomState()
    initial.playback.paused = false
    initial.playback.timelineAnchorMs = 10_000
    initial.playback.serverNowMs = Date.now()
    const store = new InMemoryRoomStateStore(initial)
    createTestBroadcastBus(store)
    const ownerCtx = createHandlerContext({ store, userId: "owner" })

    await handlePlaybackPause(
      ownerCtx,
      envelope("playback:pause", { currentTimeMs: 99_000 }),
    )
    const after = store.peek("room-1")
    expect(after?.playback.paused).toBe(true)
    // Projected ~10s, not the client's 99s local playhead.
    expect(after?.playback.timelineAnchorMs).toBeGreaterThanOrEqual(10_000)
    expect(after?.playback.timelineAnchorMs).toBeLessThan(12_000)
    expect(after?.actionLog.at(-1)?.payload).toMatchObject({
      clientCurrentTimeMs: 99_000,
    })
  })

  test("guest playback:pause never changes playing room state (NC-10)", async () => {
    const initial = createRoomState()
    initial.playback.paused = false
    initial.playback.timelineAnchorMs = 7_000
    const store = new InMemoryRoomStateStore(initial)
    createTestBroadcastBus(store)
    const fake = createFakeWs()
    const guestCtx = createHandlerContext({
      store,
      userId: "guest",
      ws: fake.ws,
    })
    const logLenBefore = store.peek("room-1")?.actionLog.length ?? 0

    await handlePlaybackPause(
      guestCtx,
      envelope("playback:pause", { currentTimeMs: 1_234 }, "req-guest-pause"),
    )

    const after = store.peek("room-1")
    expect(after?.playback.paused).toBe(false)
    expect(after?.playback.timelineAnchorMs).toBe(7_000)
    expect(after?.actionLog.length).toBe(logLenBefore)
    expect(fake.sent).toEqual([
      {
        type: "room:error",
        requestId: "req-guest-pause",
        payload: { code: "unauthorized", type: "playback:pause" },
      },
    ])

    // Guest session capabilities mirror the server gate.
    expect(
      computeSessionCapabilities({
        role: "guest",
        sessionKind: "room",
        isControlSession: false,
        controlAuthorized: false,
      }).canControlPlayback,
    ).toBe(false)
  })

  test("guest cannot pause via embed session either", async () => {
    const initial = createRoomState()
    initial.playback.paused = false
    const store = new InMemoryRoomStateStore(initial)
    createTestBroadcastBus(store)
    const guestEmbed = createHandlerContext({
      store,
      userId: "guest",
      sessionKind: "embed",
    })

    await handlePlaybackPause(
      guestEmbed,
      envelope("playback:pause", { currentTimeMs: 100 }),
    )
    expect(store.peek("room-1")?.playback.paused).toBe(false)
  })

  test("rate and loop modes mutate playback state when authorized", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    const ctx = createHandlerContext({ store, userId: "mod" })

    await handlePlaybackRate(
      ctx,
      envelope("playback:rate", { playbackRate: 1.5 }),
    )
    expect(store.peek("room-1")?.playback.playbackRate).toBe(1.5)

    await handlePlaybackLoopVideo(
      ctx,
      envelope("playback:loop:video", { mode: "always" }),
    )
    expect(store.peek("room-1")?.playback.videoLoop).toBe("always")

    await handlePlaybackLoopPlaylist(
      ctx,
      envelope("playback:loop:playlist", { mode: "once" }),
    )
    expect(store.peek("room-1")?.playback.playlistLoop).toBe("once")
  })

  test("player session cannot control playback", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    const ctx = createHandlerContext({
      store,
      userId: "owner",
      sessionKind: "player",
    })

    await handlePlaybackSeek(ctx, envelope("playback:seek", { targetMs: 99 }))
    expect(store.peek("room-1")?.playback.timelineAnchorMs).toBe(0)
  })

  test("host-site embed session can control playback by role", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    const ownerEmbed = createHandlerContext({
      store,
      userId: "owner",
      sessionKind: "embed",
    })
    const guestEmbed = createHandlerContext({
      store,
      userId: "guest",
      sessionKind: "embed",
    })

    await handlePlaybackSeek(
      guestEmbed,
      envelope("playback:seek", { targetMs: 40 }),
    )
    expect(store.peek("room-1")?.playback.timelineAnchorMs).toBe(0)

    await handlePlaybackSeek(
      ownerEmbed,
      envelope("playback:seek", { targetMs: 40 }),
    )
    expect(store.peek("room-1")?.playback.timelineAnchorMs).toBe(40)
  })

  test("control session requires controlAuthorized", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    const denied = createHandlerContext({
      store,
      userId: "owner",
      isControlSession: true,
      controlAuthorized: false,
      sessionKind: "control",
    })
    const allowed = createHandlerContext({
      store,
      userId: "owner",
      isControlSession: true,
      controlAuthorized: true,
      sessionKind: "control",
    })

    await handlePlaybackSeek(
      denied,
      envelope("playback:seek", { targetMs: 50 }),
    )
    expect(store.peek("room-1")?.playback.timelineAnchorMs).toBe(0)

    await handlePlaybackSeek(
      allowed,
      envelope("playback:seek", { targetMs: 50 }),
    )
    expect(store.peek("room-1")?.playback.timelineAnchorMs).toBe(50)
  })
})
