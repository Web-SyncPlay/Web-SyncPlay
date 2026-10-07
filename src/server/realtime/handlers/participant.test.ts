import { afterEach, describe, expect, test } from "bun:test"
import {
  createTestBroadcastBus,
  setRoomBroadcastBusForTests,
} from "@/server/realtime/broadcast/room-broadcast-bus"
import {
  handleParticipantRoleUpdate,
  handleParticipantUpdate,
  resolveLocalPlaybackError,
  resolveParticipantUpdate,
} from "@/server/realtime/handlers/participant"
import {
  createHandlerContext,
  createParticipant,
  createRoomState,
  envelope,
  InMemoryRoomStateStore,
} from "@/server/realtime/test-utils/fixtures"

describe("participant update helpers", () => {
  test("resolveLocalPlaybackError clears on null/empty and keeps omitted", () => {
    expect(resolveLocalPlaybackError(null, "stall")).toBeUndefined()
    expect(resolveLocalPlaybackError("  ", "stall")).toBeUndefined()
    expect(resolveLocalPlaybackError(undefined, "stall")).toBe("stall")
    expect(resolveLocalPlaybackError("boom", "stall")).toBe("boom")
  })

  test("resolveParticipantUpdate marks identity and playback dirty flags", () => {
    const participant = createParticipant({
      userId: "guest",
      role: "guest",
      username: "Guest",
    })
    const idle = resolveParticipantUpdate(participant, {})
    expect(idle.identityDirty).toBe(false)
    expect(idle.playbackDirty).toBe(false)

    const renamed = resolveParticipantUpdate(participant, {
      username: "Renamed",
    })
    expect(renamed.identityDirty).toBe(true)
    expect(renamed.nextUsername).toBe("Renamed")

    const seeked = resolveParticipantUpdate(participant, {
      currentTimeMs: participant.localPlayback.currentTimeMs + 1000,
    })
    expect(seeked.playbackDirty).toBe(true)
  })
})

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
        avatarStyle: "lorelei",
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
    expect(participant?.avatarStyle).toBe("lorelei")
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

  test("room + player connections aggregate loading without last-write flicker", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    const bus = createTestBroadcastBus(store)
    const roomCtx = createHandlerContext({
      store,
      userId: "owner",
      connectionId: "conn-room",
      sessionKind: "room",
    })
    const playerCtx = createHandlerContext({
      store,
      userId: "owner",
      connectionId: "conn-player",
      sessionKind: "player",
    })

    await handleParticipantUpdate(
      roomCtx,
      envelope("participant:update", {
        paused: false,
        currentTimeMs: 1000,
        loading: true,
      }),
    )
    await handleParticipantUpdate(
      playerCtx,
      envelope("participant:update", {
        paused: false,
        currentTimeMs: 1200,
        loading: false,
      }),
    )
    // Room tab keeps reporting Loading — must not flip the aggregated slot.
    await handleParticipantUpdate(
      roomCtx,
      envelope("participant:update", {
        paused: false,
        currentTimeMs: 1400,
        loading: true,
      }),
    )

    const presence = await store.getPresenceDataAll("room-1")
    expect(presence.owner?.localPlayback?.loading).toBe(false)
    expect(presence.owner?.localPlaybackReports?.["conn-room"]?.loading).toBe(
      true,
    )
    expect(presence.owner?.localPlaybackReports?.["conn-player"]?.loading).toBe(
      false,
    )

    await bus.flushPresence("room-1")
    const batch = bus.captured.find((c) => c.envelope.type === "presence:batch")
    const payload = batch?.envelope.payload as {
      participants: Record<string, { localPlaybackReports?: unknown }>
    }
    expect(payload.participants.owner?.localPlaybackReports).toBeUndefined()
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

  test("role update requires control-session auth when session is gated", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    const unauthorized = createHandlerContext({
      store,
      userId: "owner",
      isControlSession: true,
      controlAuthorized: false,
    })
    const authorized = createHandlerContext({
      store,
      userId: "owner",
      isControlSession: true,
      controlAuthorized: true,
    })

    await handleParticipantRoleUpdate(
      unauthorized,
      envelope("participant:role:update", {
        targetUserId: "guest",
        role: "moderator",
      }),
    )
    expect(store.peek("room-1")?.participants.guest?.role).toBe("guest")

    await handleParticipantRoleUpdate(
      authorized,
      envelope("participant:role:update", {
        targetUserId: "guest",
        role: "moderator",
      }),
    )
    expect(store.peek("room-1")?.participants.guest?.role).toBe("moderator")
  })

  test("role update cannot demote the room owner", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    const ownerCtx = createHandlerContext({ store, userId: "owner" })

    await handleParticipantRoleUpdate(
      ownerCtx,
      envelope("participant:role:update", {
        targetUserId: "owner",
        role: "guest",
      }),
    )
    expect(store.peek("room-1")?.participants.owner?.role).toBe("owner")
  })
})
