import { afterEach, describe, expect, mock, test } from "bun:test"
import { createHash } from "node:crypto"
import { keys } from "@/server/redis/keys"
import { roomStateTtlSeconds } from "@/zod/types"

type KvStore = Map<string, { value: string; ex?: number }>

function createRedisMock(store: KvStore) {
  return {
    set: async (
      key: string,
      value: string,
      opts?: { EX?: number },
    ) => {
      store.set(key, { value, ex: opts?.EX })
      return "OK"
    },
    get: async (key: string) => store.get(key)?.value ?? null,
    del: async (...keyList: string[]) => {
      let removed = 0
      for (const key of keyList) {
        if (store.delete(key)) removed += 1
      }
      return removed
    },
  }
}

function mockRedisClient(store: KvStore) {
  const redis = createRedisMock(store)
  mock.module("@/server/redis/client", () => ({
    getCommandClient: async () => redis,
    getSubscriberClient: async () => redis,
  }))
}

afterEach(() => {
  mock.restore()
})

describe("viewer-capability-token", () => {
  test("mint stores hash+boundIp with room TTL; validate accepts matching token/IP", async () => {
    const store: KvStore = new Map()
    mockRedisClient(store)

    const {
      mintViewerCapabilityToken,
      validateViewerCapabilityToken,
      hashViewerCapabilityToken,
    } = await import("./viewer-capability-token")

    const { token } = await mintViewerCapabilityToken({
      roomId: "room-1",
      userId: "user-1",
      boundIp: "203.0.113.10",
    })

    const key = keys.roomViewerCapability("room-1", "user-1")
    const stored = store.get(key)
    expect(stored?.ex).toBe(roomStateTtlSeconds)
    const parsed = JSON.parse(stored!.value) as {
      tokenHash: string
      boundIp: string
    }
    expect(parsed.boundIp).toBe("203.0.113.10")
    expect(parsed.tokenHash).toBe(hashViewerCapabilityToken(token))
    expect(parsed.tokenHash).toBe(
      createHash("sha256").update(token).digest("hex"),
    )
    expect(stored!.value).not.toContain(token)

    expect(
      await validateViewerCapabilityToken({
        token,
        roomId: "room-1",
        userId: "user-1",
        clientIp: "203.0.113.10",
      }),
    ).toBe(true)
  })

  test("validate denies wrong token, wrong IP, wrong user, or missing record", async () => {
    const store: KvStore = new Map()
    mockRedisClient(store)

    const {
      mintViewerCapabilityToken,
      validateViewerCapabilityToken,
    } = await import("./viewer-capability-token")

    const { token } = await mintViewerCapabilityToken({
      roomId: "room-1",
      userId: "user-1",
      boundIp: "203.0.113.10",
    })

    expect(
      await validateViewerCapabilityToken({
        token: "not-the-token",
        roomId: "room-1",
        userId: "user-1",
        clientIp: "203.0.113.10",
      }),
    ).toBe(false)

    expect(
      await validateViewerCapabilityToken({
        token,
        roomId: "room-1",
        userId: "user-1",
        clientIp: "198.51.100.1",
      }),
    ).toBe(false)

    expect(
      await validateViewerCapabilityToken({
        token,
        roomId: "room-1",
        userId: "other-user",
        clientIp: "203.0.113.10",
      }),
    ).toBe(false)

    expect(
      await validateViewerCapabilityToken({
        token,
        roomId: "other-room",
        userId: "user-1",
        clientIp: "203.0.113.10",
      }),
    ).toBe(false)

    expect(
      await validateViewerCapabilityToken({
        token: "",
        roomId: "room-1",
        userId: "user-1",
        clientIp: "203.0.113.10",
      }),
    ).toBe(false)
  })

  test("remint overwrites prior token; invalidate denies subsequent validate", async () => {
    const store: KvStore = new Map()
    mockRedisClient(store)

    const {
      mintViewerCapabilityToken,
      validateViewerCapabilityToken,
      invalidateViewerCapabilityToken,
    } = await import("./viewer-capability-token")

    const first = await mintViewerCapabilityToken({
      roomId: "room-1",
      userId: "user-1",
      boundIp: "203.0.113.10",
    })
    const second = await mintViewerCapabilityToken({
      roomId: "room-1",
      userId: "user-1",
      boundIp: "203.0.113.10",
    })

    expect(
      await validateViewerCapabilityToken({
        token: first.token,
        roomId: "room-1",
        userId: "user-1",
        clientIp: "203.0.113.10",
      }),
    ).toBe(false)
    expect(
      await validateViewerCapabilityToken({
        token: second.token,
        roomId: "room-1",
        userId: "user-1",
        clientIp: "203.0.113.10",
      }),
    ).toBe(true)

    await invalidateViewerCapabilityToken({
      roomId: "room-1",
      userId: "user-1",
    })
    expect(
      await validateViewerCapabilityToken({
        token: second.token,
        roomId: "room-1",
        userId: "user-1",
        clientIp: "203.0.113.10",
      }),
    ).toBe(false)
  })
})
