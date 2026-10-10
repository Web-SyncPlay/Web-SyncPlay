import { afterAll, afterEach, describe, expect, mock, test } from "bun:test"
import { createHash } from "node:crypto"
import type { ParticipantState } from "@/contracts/types"
import {
  createTestBroadcastBus,
  setRoomBroadcastBusForTests,
} from "@/server/realtime/broadcast/room-broadcast-bus"
import {
  createFakeWs,
  createParticipant,
  createRoomState,
  envelope,
  InMemoryRoomStateStore,
} from "@/server/realtime/test-utils/fixtures"
import { getAppNodeId } from "@/server/node-id"
import { totalPresenceRefs } from "@/server/redis/presence-ref"
import {
  getSocketMeta,
  removeSocket,
  setSocketClientIp,
} from "@/server/ws/registry"

let roomLimitAllowed = true
let ipLimitAllowed = true
const rateKeys: string[] = []
/** Room-scoped identity hash fields (userId → hash), shared redis mock. */
const identityHashes = new Map<string, string>()

function hashSecret(userSecret: string) {
  return "h1:" + createHash("sha256").update(userSecret).digest("hex")
}

mock.module("@/server/redis/client", () => ({
  getCommandClient: async () => ({
    hGet: async (_key: string, field: string) =>
      identityHashes.get(field) ?? null,
    hSetNX: async (_key: string, field: string, value: string) => {
      if (identityHashes.has(field)) return 0
      identityHashes.set(field, value)
      return 1
    },
    hSet: async (_key: string, field: string, value: string) => {
      identityHashes.set(field, value)
      return 1
    },
    expire: async () => true,
    del: async () => 1,
    sRem: async () => 1,
    sAdd: async () => 1,
    set: async () => "OK",
  }),
}))

mock.module("@/server/security/rate-limit", () => ({
  consumeRateLimit: async (params: { key: string }) => {
    rateKeys.push(params.key)
    if (params.key.startsWith("join:ip:")) {
      return {
        allowed: ipLimitAllowed,
        remaining: ipLimitAllowed ? 11 : 0,
      }
    }
    return {
      allowed: roomLimitAllowed,
      remaining: roomLimitAllowed ? 59 : 0,
    }
  },
  clientIpFromRequest: () => "unknown",
}))

const { handleRoomJoin, resolveJoinParticipantProfile } = await import("./join")

afterAll(() => {
  mock.restore()
})

describe("resolveJoinParticipantProfile", () => {
  test("keeps existing username/avatar for reconnecting participant", () => {
    const existingParticipant = {
      userId: "user-1",
      username: "Existing Name",
      avatarStyle: "avataaars",
      role: "guest",
      connected: false,
      joinedAt: 1,
      connectedAt: 1,
      disconnectedAt: 2,
      lastSeenAt: 2,
      localPlayback: {
        paused: true,
        currentTimeMs: 0,
        loading: false,
        updatedAt: 1,
      },
    } satisfies ParticipantState

    const profile = resolveJoinParticipantProfile(existingParticipant, {
      username: "Incoming Name",
      avatarStyle: "adventurer",
    })

    expect(profile).toEqual({
      username: "Existing Name",
      avatarStyle: "avataaars",
    })
  })

  test("uses incoming username/avatar for first-time join", () => {
    const profile = resolveJoinParticipantProfile(undefined, {
      username: "Incoming Name",
      avatarStyle: "adventurer",
    })

    expect(profile).toEqual({
      username: "Incoming Name",
      avatarStyle: "adventurer",
    })
  })
})

describe("handleRoomJoin", () => {
  afterEach(() => {
    setRoomBroadcastBusForTests(null)
    roomLimitAllowed = true
    ipLimitAllowed = true
    rateKeys.length = 0
    identityHashes.clear()
  })

  function joinEnvelope(overrides: Record<string, unknown> = {}) {
    return envelope(
      "room:join",
      {
        roomId: "room-1",
        userId: "guest",
        userSecret: "secret-guest",
        username: "Guest",
        ...overrides,
      },
      "req-join-1",
    )
  }

  test("rejects identity mismatch without adding presence or stealing role", async () => {
    identityHashes.set("owner", hashSecret("real-owner-secret"))

    const store = new InMemoryRoomStateStore(
      createRoomState({
        participants: {
          owner: createParticipant({
            userId: "owner",
            role: "owner",
            username: "Owner",
          }),
          guest: createParticipant({
            userId: "guest",
            role: "guest",
            username: "Guest",
            connected: false,
          }),
        },
      }),
    )
    const ownerRefsBefore = totalPresenceRefs(
      store.presence.get("room-1")?.get("owner") ?? {},
    )
    createTestBroadcastBus(store)
    const { ws, sent } = createFakeWs()
    setSocketClientIp(ws, "198.51.100.10")

    await handleRoomJoin(
      { ws, store },
      joinEnvelope({ userId: "owner", userSecret: "imposter-secret" }),
    )

    expect(sent).toContainEqual({
      type: "room:join:rejected",
      requestId: "req-join-1",
      payload: { reason: "identity_mismatch" },
    })
    expect(getSocketMeta(ws)).toBeUndefined()
    expect(
      totalPresenceRefs(store.presence.get("room-1")?.get("owner") ?? {}),
    ).toBe(ownerRefsBefore)
    expect(store.peek("room-1")?.participants.owner?.role).toBe("owner")
    expect(store.peek("room-1")?.participants.owner?.connected).toBe(true)
    expect(store.peek("room-1")?.participants.owner?.username).toBe("Owner")
  })

  test("IP rate bucket can reject independently of room bucket", async () => {
    ipLimitAllowed = false
    roomLimitAllowed = true

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
          }),
        },
      }),
    )
    expect(store.presence.get("room-1")?.has("guest")).toBe(false)
    createTestBroadcastBus(store)
    const { ws, sent } = createFakeWs()
    setSocketClientIp(ws, "203.0.113.99")

    await handleRoomJoin({ ws, store }, joinEnvelope())

    expect(rateKeys).toContain("join:room:room-1")
    expect(rateKeys).toContain("join:ip:203.0.113.99:room:room-1")
    expect(sent).toContainEqual({
      type: "room:join:rejected",
      requestId: "req-join-1",
      payload: { reason: "rate_limited" },
    })
    expect(getSocketMeta(ws)).toBeUndefined()
    expect(store.presence.get("room-1")?.has("guest")).toBe(false)
  })

  test("falls back to unknown IP bucket when meta has no IP", async () => {
    ipLimitAllowed = false

    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    const { ws, sent } = createFakeWs()

    await handleRoomJoin({ ws, store }, joinEnvelope())

    expect(rateKeys).toContain("join:ip:unknown:room:room-1")
    expect(
      sent.some((m) => (m as { type?: string }).type === "room:join:rejected"),
    ).toBe(true)
  })

  test("successful join adds presence only after commit", async () => {
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
          }),
        },
      }),
    )
    expect(store.presence.get("room-1")?.has("guest")).toBe(false)
    createTestBroadcastBus(store)
    const { ws, sent } = createFakeWs()
    setSocketClientIp(ws, "192.0.2.1")

    await handleRoomJoin({ ws, store }, joinEnvelope())

    expect(getSocketMeta(ws)?.presenceTracked).toBe(true)
    expect(getSocketMeta(ws)?.joinCommitted).toBe(true)
    expect(totalPresenceRefs(store.presence.get("room-1")?.get("guest") ?? {})).toBe(
      1,
    )
    expect((await store.getWsPresenceUserIds("room-1")).has("guest")).toBe(true)
    expect(identityHashes.get("guest")?.startsWith("h1:")).toBe(true)
    expect(
      sent.some((m) => (m as { type?: string }).type === "session:capabilities"),
    ).toBe(true)
    expect(
      sent.some((m) => (m as { type?: string }).type === "room:join:rejected"),
    ).toBe(false)

    removeSocket(ws)
  })

  test("aborts presence when socket closes after commit (R1)", async () => {
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
          }),
        },
      }),
    )
    expect(store.presence.get("room-1")?.has("guest")).toBe(false)
    createTestBroadcastBus(store)
    const { ws, sent } = createFakeWs()
    setSocketClientIp(ws, "192.0.2.55")

    const originalUpdate = store.updateRoom.bind(store)
    store.updateRoom = async (roomId, mutate) => {
      const next = await originalUpdate(roomId, mutate)
      // Race: client disconnects after WATCH commit, before presence/membership.
      ws.close()
      removeSocket(ws)
      return next
    }

    await handleRoomJoin({ ws, store }, joinEnvelope())

    expect(sent).toContainEqual({
      type: "room:join:rejected",
      requestId: "req-join-1",
      payload: { reason: "connection_closed" },
    })
    expect(getSocketMeta(ws)).toBeUndefined()
    expect(store.presence.get("room-1")?.has("guest")).toBe(false)
    expect(store.peek("room-1")?.participants.guest?.connected).toBe(false)
    expect(
      sent.some((m) => (m as { type?: string }).type === "room:snapshot"),
    ).toBe(false)
  })

  test("abort after commit does not leave connected ghost (H2)", async () => {
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
          }),
        },
      }),
    )
    store.presence.set(
      "room-1",
      new Map([["owner", { [getAppNodeId()]: 1 }]]),
    )
    createTestBroadcastBus(store)
    const { ws, sent } = createFakeWs()
    setSocketClientIp(ws, "192.0.2.56")

    const originalUpdate = store.updateRoom.bind(store)
    store.updateRoom = async (roomId, mutate) => {
      const next = await originalUpdate(roomId, mutate)
      // Commit wrote connected:true; socket dies before membership/presence.
      if (next?.participants.guest?.connected === true) {
        ws.close()
        removeSocket(ws)
      }
      return next
    }

    await handleRoomJoin({ ws, store }, joinEnvelope())

    expect(sent).toContainEqual({
      type: "room:join:rejected",
      requestId: "req-join-1",
      payload: { reason: "connection_closed" },
    })
    expect(getSocketMeta(ws)).toBeUndefined()
    expect(store.presence.get("room-1")?.has("guest")).toBe(false)
    expect(store.peek("room-1")?.participants.guest?.connected).toBe(false)
    expect(store.peek("room-1")?.participants.guest?.disconnectedAt).toBeDefined()
    expect(
      store.peek("room-1")?.actionLog.some(
        (e) => e.action === "participant:disconnected",
      ),
    ).toBe(true)
  })

  test("abort after adding presence keeps other tab/node refs (H1)", async () => {
    const otherNodeId = "other-node"
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
            connected: true,
          }),
        },
      }),
    )
    // Same user already present on another tab/node.
    store.presence.set(
      "room-1",
      new Map([["guest", { [otherNodeId]: 1 }]]),
    )
    store.aliveNodeIds = new Set([getAppNodeId(), otherNodeId])
    createTestBroadcastBus(store)
    const { ws, sent } = createFakeWs()
    setSocketClientIp(ws, "192.0.2.77")

    const originalAdd = store.addWsConnectionRef.bind(store)
    store.addWsConnectionRef = async (roomId, userId) => {
      await originalAdd(roomId, userId)
      // Race: disconnect after this join added a ref (D3 / post-presence R1).
      ws.close()
      removeSocket(ws)
    }

    await handleRoomJoin({ ws, store }, joinEnvelope())

    expect(sent).toContainEqual({
      type: "room:join:rejected",
      requestId: "req-join-1",
      payload: { reason: "connection_closed" },
    })
    expect(getSocketMeta(ws)).toBeUndefined()
    const guestRefs = store.presence.get("room-1")?.get("guest") ?? {}
    expect(guestRefs[otherNodeId]).toBe(1)
    expect(guestRefs[getAppNodeId()]).toBeUndefined()
    expect(totalPresenceRefs(guestRefs)).toBe(1)
    expect((await store.getWsPresenceUserIds("room-1")).has("guest")).toBe(true)
    // Remaining tab/node presence: do not mark offline (H2 must not over-compensate).
    expect(store.peek("room-1")?.participants.guest?.connected).toBe(true)
    expect(
      sent.some((m) => (m as { type?: string }).type === "room:snapshot"),
    ).toBe(false)
  })

  test("heals ownership on join when owner is offline", async () => {
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
    // Mod already has a live presence ref so reconcile keeps them connected.
    store.presence.set(
      "room-1",
      new Map([["mod", { [getAppNodeId()]: 1 }]]),
    )
    createTestBroadcastBus(store)
    const { ws } = createFakeWs()

    await handleRoomJoin({ ws, store }, joinEnvelope())

    const state = store.peek("room-1")
    expect(state?.ownerId).toBe("mod")
    expect(state?.participants.mod?.role).toBe("owner")
    expect(
      state?.actionLog.some(
        (e) =>
          e.action === "participant:owner:transferred" &&
          (e.payload as { reason?: string }).reason === "join",
      ),
    ).toBe(true)

    removeSocket(ws)
  })
})
