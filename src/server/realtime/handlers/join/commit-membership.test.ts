import { afterAll, afterEach, describe, expect, mock, test } from "bun:test"
import { getAppNodeId } from "@/server/node-id"
import {
  createFakeWs,
  createParticipant,
  createRoomState,
  InMemoryRoomStateStore,
} from "@/server/realtime/test-utils/fixtures"
import { setJoinPassword } from "@/server/realtime/services/room-security"
import { totalPresenceRefs } from "@/server/redis/presence-ref"
import { getSocketMeta } from "@/server/ws/registry"

mock.module("@/server/redis/client", () => ({
  getCommandClient: async () => ({
    del: async () => 1,
    sRem: async () => 1,
    sAdd: async () => 1,
    set: async () => "OK",
    expire: async () => true,
  }),
}))

const { commitJoinMembership } = await import("./commit-membership")

afterAll(() => {
  mock.restore()
})

function baseInput(
  store: InMemoryRoomStateStore,
  ws: ReturnType<typeof createFakeWs>["ws"],
  overrides: Partial<Parameters<typeof commitJoinMembership>[0]> = {},
) {
  return {
    ws,
    store,
    roomId: "room-1",
    userId: "guest",
    username: "Guest",
    avatarStyle: "adventurer",
    joinPassword: undefined as string | undefined,
    seedUrl: undefined as string | undefined,
    sessionKind: "room" as const,
    isControlSession: false,
    controlAuthorized: false,
    isPresenceAlreadyTracked: false,
    requestId: "req-commit-1",
    ...overrides,
  }
}

describe("commitJoinMembership", () => {
  afterEach(() => {
    // no shared mutable state
  })

  test("R2: commits participant without registry membership or presence ref", async () => {
    const store = new InMemoryRoomStateStore(
      createRoomState({
        participants: {
          owner: createParticipant({
            userId: "owner",
            role: "owner",
            connected: true,
          }),
          guest: createParticipant({
            userId: "guest",
            role: "guest",
            connected: false,
            username: "Existing Guest",
            avatarStyle: "avataaars",
          }),
        },
      }),
    )
    // Owner already present; guest must not gain a ref from commit alone.
    store.presence.set(
      "room-1",
      new Map([["owner", { [getAppNodeId()]: 1 }]]),
    )
    const { ws, sent } = createFakeWs()
    const presenceBefore = totalPresenceRefs(
      store.presence.get("room-1")?.get("guest") ?? {},
    )

    const result = await commitJoinMembership(baseInput(store, ws))

    expect(result.committed).not.toBeNull()
    expect(result.committed?.participants.guest?.connected).toBe(true)
    expect(result.committed?.participants.guest?.username).toBe(
      "Existing Guest",
    )
    expect(result.committed?.participants.guest?.avatarStyle).toBe("avataaars")
    expect(result.sessionCapabilities).toBeDefined()
    expect(result.committed!.generation).toBe(1)
    expect(result.committed!.structuralRevision).toBe(1)
    // R2: commit must not register the socket or bump presence.
    expect(getSocketMeta(ws)).toBeUndefined()
    expect(
      totalPresenceRefs(store.presence.get("room-1")?.get("guest") ?? {}),
    ).toBe(presenceBefore)
    expect(sent).toEqual([])
    expect(
      result.committed?.actionLog.some((e) => e.action === "participant:joined"),
    ).toBe(true)
  })

  test("R5: rejects inside WATCH when password flips mid-join", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    const { ws, sent } = createFakeWs()

    const originalUpdate = store.updateRoom.bind(store)
    store.updateRoom = async (roomId, mutate) => {
      return originalUpdate(roomId, async (existing) => {
        if (existing) {
          await setJoinPassword(existing, "locked-now")
        }
        return mutate(existing)
      })
    }

    const result = await commitJoinMembership(
      baseInput(store, ws, { joinPassword: undefined }),
    )

    expect(result.committed).toBeNull()
    expect(result.sessionCapabilities).toBeUndefined()
    expect(sent).toContainEqual({
      type: "room:join:rejected",
      requestId: "req-commit-1",
      payload: { reason: "password_required" },
    })
    expect(store.peek("room-1")?.participants.guest?.connected).toBe(true)
  })

  test("skips participant:joined when presence already tracked and connected", async () => {
    const store = new InMemoryRoomStateStore(
      createRoomState({
        participants: {
          owner: createParticipant({ userId: "owner", role: "owner" }),
          guest: createParticipant({
            userId: "guest",
            role: "guest",
            connected: true,
          }),
        },
      }),
    )
    const { ws } = createFakeWs()

    const result = await commitJoinMembership(
      baseInput(store, ws, { isPresenceAlreadyTracked: true }),
    )

    expect(result.committed).not.toBeNull()
    expect(
      result.committed?.actionLog.some((e) => e.action === "participant:joined"),
    ).toBe(false)
  })

  test("heals ownership when owner is offline and joiner connects", async () => {
    const store = new InMemoryRoomStateStore(
      createRoomState({
        participants: {
          owner: createParticipant({
            userId: "owner",
            role: "owner",
            connected: false,
          }),
          guest: createParticipant({
            userId: "guest",
            role: "guest",
            connected: false,
            joinedAt: 5,
          }),
          mod: createParticipant({
            userId: "mod",
            role: "moderator",
            connected: true,
            joinedAt: 10,
          }),
        },
      }),
    )
    store.presence.set(
      "room-1",
      new Map([["mod", { [getAppNodeId()]: 1 }]]),
    )
    const { ws } = createFakeWs()

    const result = await commitJoinMembership(baseInput(store, ws))

    expect(result.committed?.ownerId).toBe("mod")
    expect(result.committed?.participants.mod?.role).toBe("owner")
    expect(
      result.committed?.actionLog.some(
        (e) =>
          e.action === "participant:owner:transferred" &&
          (e.payload as { reason?: string }).reason === "join",
      ),
    ).toBe(true)
  })

  test("creates room from seed when none exists", async () => {
    const store = new InMemoryRoomStateStore()
    store.dailyDefaults = [
      { title: "Default", url: "https://example.com/default.mp4" },
    ]
    const { ws } = createFakeWs()

    const result = await commitJoinMembership(
      baseInput(store, ws, {
        userId: "creator",
        username: "Creator",
        seedUrl: "https://example.com/seed.mp4",
      }),
    )

    expect(result.committed).not.toBeNull()
    expect(result.committed?.roomId).toBe("room-1")
    expect(result.committed?.ownerId).toBe("creator")
    expect(result.committed?.participants.creator?.role).toBe("owner")
    expect(result.committed?.participants.creator?.connected).toBe(true)
  })
})
