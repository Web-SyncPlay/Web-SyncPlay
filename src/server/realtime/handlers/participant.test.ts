import { afterEach, describe, expect, test } from "bun:test"
import {
  createTestBroadcastBus,
  setRoomBroadcastBusForTests,
} from "@/server/realtime/broadcast/room-broadcast-bus"
import {
  handleParticipantRoleUpdate,
  handleParticipantUpdate,
} from "@/server/realtime/handlers/participant"
import {
  createHandlerContext,
  createRoomState,
  envelope,
  InMemoryRoomStateStore,
} from "@/server/realtime/test-utils/fixtures"

describe("participant handler interfaces", () => {
  afterEach(() => {
    setRoomBroadcastBusForTests(null)
  })

  test("update writes presence HASH for local playback and room for identity", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    const ctx = createHandlerContext({ store, userId: "guest" })

    await handleParticipantUpdate(
      ctx,
      envelope("participant:update", {
        username: "New Guest",
        avatarStyle: "thumbs",
        paused: false,
        currentTimeMs: 1234,
        loading: true,
        error: "stall",
      }),
    )

    const presence = await store.getPresenceDataAll("room-1")
    expect(presence.guest?.localPlayback?.currentTimeMs).toBe(1234)
    expect(presence.guest?.localPlayback?.paused).toBe(false)

    const participant = store.peek("room-1")?.participants.guest
    expect(participant?.username).toBe("New Guest")
    expect(participant?.avatarStyle).toBe("thumbs")
    expect(participant?.localPlayback.error).toBe("stall")
  })

  test("explicit null clears a previously sticky localPlayback error", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    const ctx = createHandlerContext({ store, userId: "owner" })

    await handleParticipantUpdate(
      ctx,
      envelope("participant:update", {
        paused: false,
        currentTimeMs: 1000,
        loading: false,
        error: "Playback stalled: recovering…",
      }),
    )
    expect(store.peek("room-1")?.participants.owner?.localPlayback.error).toBe(
      "Playback stalled: recovering…",
    )

    await handleParticipantUpdate(
      ctx,
      envelope("participant:update", {
        paused: false,
        currentTimeMs: 2000,
        loading: false,
        error: null,
      }),
    )

    const presence = await store.getPresenceDataAll("room-1")
    expect(presence.owner?.localPlayback?.error).toBeUndefined()
    expect(
      store.peek("room-1")?.participants.owner?.localPlayback.error,
    ).toBeUndefined()
  })

  test("omitted error keeps previous localPlayback error (partial update)", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    const ctx = createHandlerContext({ store, userId: "owner" })

    await handleParticipantUpdate(
      ctx,
      envelope("participant:update", { error: "stall" }),
    )
    await handleParticipantUpdate(
      ctx,
      envelope("participant:update", { username: "Owner Renamed" }),
    )

    expect(store.peek("room-1")?.participants.owner?.localPlayback.error).toBe(
      "stall",
    )
    expect(store.peek("room-1")?.participants.owner?.username).toBe(
      "Owner Renamed",
    )
  })

  test("playback-only tick does not bump room generation", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    const bus = createTestBroadcastBus(store)
    const ctx = createHandlerContext({ store, userId: "guest" })
    const beforeGen = store.peek("room-1")!.generation

    await handleParticipantUpdate(
      ctx,
      envelope("participant:update", {
        paused: false,
        currentTimeMs: 5000,
        loading: false,
      }),
    )

    expect(store.peek("room-1")!.generation).toBe(beforeGen)
    const presence = await store.getPresenceDataAll("room-1")
    expect(presence.guest?.localPlayback?.currentTimeMs).toBe(5000)
    await bus.flushPresence("room-1")
    expect(bus.captured.some((c) => c.envelope.type === "presence:batch")).toBe(
      true,
    )
  })

  test("rejects invalid update payload", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    const ctx = createHandlerContext({ store, userId: "guest" })

    await handleParticipantUpdate(
      ctx,
      envelope("participant:update", { username: "" }),
    )
    expect(store.peek("room-1")?.participants.guest?.username).toBe("Guest")
  })

  test("only owner can change roles and cannot promote to owner", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    const guestCtx = createHandlerContext({ store, userId: "guest" })
    const ownerCtx = createHandlerContext({ store, userId: "owner" })

    await handleParticipantRoleUpdate(
      guestCtx,
      envelope("participant:role:update", {
        targetUserId: "guest",
        role: "moderator",
      }),
    )
    expect(store.peek("room-1")?.participants.guest?.role).toBe("guest")

    await handleParticipantRoleUpdate(
      ownerCtx,
      envelope("participant:role:update", {
        targetUserId: "guest",
        role: "owner",
      }),
    )
    expect(store.peek("room-1")?.participants.guest?.role).toBe("guest")

    await handleParticipantRoleUpdate(
      ownerCtx,
      envelope("participant:role:update", {
        targetUserId: "guest",
        role: "moderator",
      }),
    )
    expect(store.peek("room-1")?.participants.guest?.role).toBe("moderator")
  })
})
