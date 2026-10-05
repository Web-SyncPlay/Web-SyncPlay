import { describe, expect, test } from "bun:test"
import {
  handlePlaybackLoopPlaylist,
  handlePlaybackLoopVideo,
  handlePlaybackPause,
  handlePlaybackPlay,
  handlePlaybackRate,
  handlePlaybackSeek,
} from "@/server/realtime/handlers/playback"
import {
  createHandlerContext,
  createRoomState,
  envelope,
  InMemoryRoomStateStore,
} from "@/server/realtime/test-utils/fixtures"

describe("playback handler interfaces", () => {
  test("seek updates timeline for owner and rejects invalid payload", async () => {
    const state = createRoomState()
    const store = new InMemoryRoomStateStore(state)
    const ctx = createHandlerContext({ store, userId: "owner" })

    await handlePlaybackSeek(ctx, envelope("playback:seek", { targetMs: -1 }))
    expect(store.peek("room-1")?.playback.timelineAnchorMs).toBe(0)

    await handlePlaybackSeek(ctx, envelope("playback:seek", { targetMs: 12_000 }))
    const next = store.peek("room-1")
    expect(next?.playback.timelineAnchorMs).toBe(12_000)
    expect(next?.playback.seekPreview?.active).toBe(false)
    expect(next?.actionLog.at(-1)?.action).toBe("playback:seek")
  })

  test("play/pause toggle paused flag and ignore guest control", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
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
    expect(store.peek("room-1")?.playback.timelineAnchorMs).toBe(5_000)

    await handlePlaybackPause(ownerCtx, envelope("playback:pause", {}))
    expect(store.peek("room-1")?.playback.paused).toBe(true)
  })

  test("rate and loop modes mutate playback state when authorized", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    const ctx = createHandlerContext({ store, userId: "mod" })

    await handlePlaybackRate(ctx, envelope("playback:rate", { playbackRate: 1.5 }))
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
    const ctx = createHandlerContext({
      store,
      userId: "owner",
      sessionKind: "player",
    })

    await handlePlaybackSeek(ctx, envelope("playback:seek", { targetMs: 99 }))
    expect(store.peek("room-1")?.playback.timelineAnchorMs).toBe(0)
  })

  test("control session requires controlAuthorized", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
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

    await handlePlaybackSeek(denied, envelope("playback:seek", { targetMs: 50 }))
    expect(store.peek("room-1")?.playback.timelineAnchorMs).toBe(0)

    await handlePlaybackSeek(allowed, envelope("playback:seek", { targetMs: 50 }))
    expect(store.peek("room-1")?.playback.timelineAnchorMs).toBe(50)
  })
})
