import { describe, expect, test } from "bun:test"
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
  test("update mutates self profile and local playback", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
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

    const participant = store.peek("room-1")?.participants.guest
    expect(participant?.username).toBe("New Guest")
    expect(participant?.avatarStyle).toBe("thumbs")
    expect(participant?.localPlayback.paused).toBe(false)
    expect(participant?.localPlayback.currentTimeMs).toBe(1234)
    expect(participant?.localPlayback.loading).toBe(true)
    expect(participant?.localPlayback.error).toBe("stall")
  })

  test("rejects invalid update payload", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    const ctx = createHandlerContext({ store, userId: "guest" })

    await handleParticipantUpdate(
      ctx,
      envelope("participant:update", { username: "" }),
    )
    expect(store.peek("room-1")?.participants.guest?.username).toBe("Guest")
  })

  test("only owner can change roles and cannot promote to owner", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
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
