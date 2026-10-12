import { afterAll, afterEach, describe, expect, mock, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  createTestBroadcastBus,
  setRoomBroadcastBusForTests,
} from "@/server/realtime/broadcast/room-broadcast-bus"
import { handlePlaybackPause } from "@/server/realtime/handlers/playback"
import {
  createFakeWs,
  createHandlerContext,
  createParticipant,
  createRoomState,
  envelope,
  InMemoryRoomStateStore,
} from "@/server/realtime/test-utils/fixtures"
import {
  getSocketMeta,
  removeSocket,
  setSocketClientIp,
} from "@/server/ws/registry"

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
  consumeRateLimit: async () => ({ allowed: true, remaining: 59 }),
  clientIpFromRequest: () => "unknown",
}))

const { handleRoomJoin } = await import("./join")

afterAll(() => {
  mock.restore()
})

function capsPayload(sent: unknown[]) {
  const msg = sent.find(
    (m) => (m as { type?: string }).type === "session:capabilities",
  ) as
    | {
        payload?: {
          canControlPlayback?: boolean
          canManagePlaylist?: boolean
          sessionKind?: string
        }
      }
    | undefined
  return msg?.payload
}

describe("multi-session room control", () => {
  afterEach(() => {
    setRoomBroadcastBusForTests(null)
    identityHashes.clear()
  })

  test("two concurrent room sessions for the same owner both keep control caps and can pause", async () => {
    identityHashes.set("owner", hashSecret("secret-owner"))
    const store = new InMemoryRoomStateStore(
      createRoomState({
        participants: {
          owner: createParticipant({
            userId: "owner",
            role: "owner",
            connected: true,
            username: "Owner",
          }),
        },
      }),
    )
    createTestBroadcastBus(store)

    const first = createFakeWs()
    setSocketClientIp(first.ws, "192.0.2.10")
    await handleRoomJoin(
      { ws: first.ws, store },
      envelope(
        "room:join",
        {
          roomId: "room-1",
          userId: "owner",
          userSecret: "secret-owner",
          username: "Owner",
          sessionKind: "room",
        },
        "req-join-1",
      ),
    )

    const second = createFakeWs()
    setSocketClientIp(second.ws, "192.0.2.11")
    await handleRoomJoin(
      { ws: second.ws, store },
      envelope(
        "room:join",
        {
          roomId: "room-1",
          userId: "owner",
          userSecret: "secret-owner",
          username: "Owner",
          sessionKind: "room",
        },
        "req-join-2",
      ),
    )

    expect(capsPayload(first.sent)?.canControlPlayback).toBe(true)
    expect(capsPayload(first.sent)?.canManagePlaylist).toBe(true)
    expect(capsPayload(second.sent)?.canControlPlayback).toBe(true)
    expect(capsPayload(second.sent)?.canManagePlaylist).toBe(true)
    expect(getSocketMeta(first.ws)?.canControlPlayback).toBe(true)
    expect(getSocketMeta(second.ws)?.canControlPlayback).toBe(true)
    expect(store.peek("room-1")?.participants.owner?.role).toBe("owner")

    store.peek("room-1")!.playback.paused = false
    const secondCtx = createHandlerContext({
      store,
      userId: "owner",
      sessionKind: "room",
      ws: second.ws,
    })
    await handlePlaybackPause(
      secondCtx,
      envelope("playback:pause", {}, "req-pause-2"),
    )

    expect(store.peek("room-1")?.playback.paused).toBe(true)
    expect(
      second.sent.some((m) => (m as { type?: string }).type === "room:error"),
    ).toBe(false)

    removeSocket(first.ws)
    removeSocket(second.ws)
  })

  test("two concurrent room sessions for a moderator both keep control caps", async () => {
    identityHashes.set("mod", hashSecret("secret-mod"))
    const store = new InMemoryRoomStateStore(
      createRoomState({
        participants: {
          owner: createParticipant({
            userId: "owner",
            role: "owner",
            connected: true,
          }),
          mod: createParticipant({
            userId: "mod",
            role: "moderator",
            connected: true,
            username: "Mod",
          }),
        },
      }),
    )
    createTestBroadcastBus(store)

    const first = createFakeWs()
    setSocketClientIp(first.ws, "192.0.2.20")
    await handleRoomJoin(
      { ws: first.ws, store },
      envelope(
        "room:join",
        {
          roomId: "room-1",
          userId: "mod",
          userSecret: "secret-mod",
          username: "Mod",
          sessionKind: "room",
        },
        "req-mod-1",
      ),
    )

    const second = createFakeWs()
    setSocketClientIp(second.ws, "192.0.2.21")
    await handleRoomJoin(
      { ws: second.ws, store },
      envelope(
        "room:join",
        {
          roomId: "room-1",
          userId: "mod",
          userSecret: "secret-mod",
          username: "Mod",
          sessionKind: "room",
        },
        "req-mod-2",
      ),
    )

    expect(capsPayload(first.sent)?.canControlPlayback).toBe(true)
    expect(capsPayload(second.sent)?.canControlPlayback).toBe(true)
    expect(store.peek("room-1")?.participants.mod?.role).toBe("moderator")

    removeSocket(first.ws)
    removeSocket(second.ws)
  })

  test("player sessionKind stays non-mutating even when the same owner has a controlling room session", async () => {
    identityHashes.set("owner", hashSecret("secret-owner"))
    const store = new InMemoryRoomStateStore(
      createRoomState({
        participants: {
          owner: createParticipant({
            userId: "owner",
            role: "owner",
            connected: true,
            username: "Owner",
          }),
        },
      }),
    )
    createTestBroadcastBus(store)

    const roomSession = createFakeWs()
    setSocketClientIp(roomSession.ws, "192.0.2.30")
    await handleRoomJoin(
      { ws: roomSession.ws, store },
      envelope(
        "room:join",
        {
          roomId: "room-1",
          userId: "owner",
          userSecret: "secret-owner",
          username: "Owner",
          sessionKind: "room",
        },
        "req-room",
      ),
    )

    const playerSession = createFakeWs()
    setSocketClientIp(playerSession.ws, "192.0.2.31")
    await handleRoomJoin(
      { ws: playerSession.ws, store },
      envelope(
        "room:join",
        {
          roomId: "room-1",
          userId: "owner",
          userSecret: "secret-owner",
          username: "Owner",
          sessionKind: "player",
        },
        "req-player",
      ),
    )

    expect(capsPayload(roomSession.sent)?.canControlPlayback).toBe(true)
    expect(capsPayload(playerSession.sent)?.canControlPlayback).toBe(false)
    expect(capsPayload(playerSession.sent)?.sessionKind).toBe("player")
    expect(getSocketMeta(playerSession.ws)?.canControlPlayback).toBe(false)

    store.peek("room-1")!.playback.paused = false
    const playerCtx = createHandlerContext({
      store,
      userId: "owner",
      sessionKind: "player",
      ws: playerSession.ws,
    })
    await handlePlaybackPause(
      playerCtx,
      envelope("playback:pause", {}, "req-player-pause"),
    )
    expect(store.peek("room-1")?.playback.paused).toBe(false)

    removeSocket(roomSession.ws)
    removeSocket(playerSession.ws)
  })
})
