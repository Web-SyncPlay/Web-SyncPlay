import { afterAll, afterEach, describe, expect, mock, test } from "bun:test"
import {
  createFakeWs,
  createParticipant,
  createRoomState,
} from "@/server/realtime/test-utils/fixtures"
import { setJoinPassword } from "@/server/realtime/services/room-security"
import { setSocketClientIp } from "@/server/ws/registry"

let roomLimitAllowed = true
let ipLimitAllowed = true
const rateKeys: string[] = []

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

const { admitJoin } = await import("./admit")

afterAll(() => {
  mock.restore()
})

describe("admitJoin", () => {
  afterEach(() => {
    roomLimitAllowed = true
    ipLimitAllowed = true
    rateKeys.length = 0
  })

  test("rejects room rate limit before IP / password checks", async () => {
    roomLimitAllowed = false
    const { ws, sent } = createFakeWs()
    setSocketClientIp(ws, "198.51.100.1")

    const result = await admitJoin({
      ws,
      roomId: "room-1",
      joinPassword: undefined,
      initialMediaUrl: undefined,
      existingState: createRoomState(),
      requestId: "req-admit-1",
    })

    expect(result).toEqual({ ok: false })
    expect(rateKeys).toEqual(["join:room:room-1"])
    expect(sent).toEqual([
      {
        type: "room:join:rejected",
        requestId: "req-admit-1",
        payload: { reason: "rate_limited" },
      },
    ])
  })

  test("rejects IP rate limit independently of room bucket", async () => {
    ipLimitAllowed = false
    const { ws, sent } = createFakeWs()
    setSocketClientIp(ws, "203.0.113.10")

    const result = await admitJoin({
      ws,
      roomId: "room-1",
      joinPassword: undefined,
      initialMediaUrl: undefined,
      existingState: createRoomState(),
      requestId: "req-admit-2",
    })

    expect(result).toEqual({ ok: false })
    expect(rateKeys).toContain("join:room:room-1")
    expect(rateKeys).toContain("join:ip:203.0.113.10:room:room-1")
    expect(sent).toContainEqual({
      type: "room:join:rejected",
      requestId: "req-admit-2",
      payload: { reason: "rate_limited" },
    })
  })

  test("rejects unsupported create-media seed on new room", async () => {
    const { ws, sent } = createFakeWs()

    const result = await admitJoin({
      ws,
      roomId: "room-new",
      joinPassword: undefined,
      initialMediaUrl: "ftp://internal/not-http",
      existingState: null,
      requestId: "req-admit-3",
    })

    expect(result).toEqual({ ok: false })
    expect(sent).toContainEqual({
      type: "room:join:rejected",
      requestId: "req-admit-3",
      payload: { reason: "media_url_unsupported" },
    })
  })

  test("rejects missing join password when room requires one", async () => {
    const state = createRoomState({
      participants: {
        owner: createParticipant({ userId: "owner", role: "owner" }),
      },
    })
    await setJoinPassword(state, "hunter2")
    const { ws, sent } = createFakeWs()

    const result = await admitJoin({
      ws,
      roomId: "room-1",
      joinPassword: undefined,
      initialMediaUrl: undefined,
      existingState: state,
      requestId: "req-admit-4",
    })

    expect(result).toEqual({ ok: false })
    expect(sent).toContainEqual({
      type: "room:join:rejected",
      requestId: "req-admit-4",
      payload: { reason: "password_required" },
    })
  })

  test("rejects invalid join password", async () => {
    const state = createRoomState()
    await setJoinPassword(state, "hunter2")
    const { ws, sent } = createFakeWs()

    const result = await admitJoin({
      ws,
      roomId: "room-1",
      joinPassword: "wrong",
      initialMediaUrl: undefined,
      existingState: state,
      requestId: "req-admit-5",
    })

    expect(result).toEqual({ ok: false })
    expect(sent).toContainEqual({
      type: "room:join:rejected",
      requestId: "req-admit-5",
      payload: { reason: "invalid_password" },
    })
  })

  test("allows admission and returns create-media seedUrl", async () => {
    const { ws, sent } = createFakeWs()
    setSocketClientIp(ws, "192.0.2.8")

    const result = await admitJoin({
      ws,
      roomId: "room-new",
      joinPassword: undefined,
      initialMediaUrl: "https://example.com/seed.mp4",
      existingState: null,
      requestId: "req-admit-6",
    })

    expect(result).toEqual({
      ok: true,
      seedUrl: "https://example.com/seed.mp4",
    })
    expect(sent).toEqual([])
    expect(rateKeys).toContain("join:room:room-new")
    expect(rateKeys).toContain("join:ip:192.0.2.8:room:room-new")
  })

  test("existing room ignores initialMediaUrl seed", async () => {
    const { ws } = createFakeWs()

    const result = await admitJoin({
      ws,
      roomId: "room-1",
      joinPassword: undefined,
      initialMediaUrl: "https://example.com/ignored.mp4",
      existingState: createRoomState(),
    })

    expect(result).toEqual({ ok: true, seedUrl: undefined })
  })
})
