import { afterEach, describe, expect, mock, test } from "bun:test"

type HashStore = Map<string, string>

function createRedisMock(store: HashStore) {
  return {
    hGet: async (_key: string, field: string) => store.get(field) ?? null,
    hSet: async (_key: string, field: string, value: string) => {
      store.set(field, value)
      return 1
    },
    hSetNX: async (_key: string, field: string, value: string) => {
      if (store.has(field)) return 0
      store.set(field, value)
      return 1
    },
    expire: async () => true,
    del: async () => {
      store.clear()
      return 1
    },
  }
}

afterEach(() => {
  mock.restore()
})

describe("identity-store", () => {
  test("claims with hashed secret and verifies matching joins", async () => {
    const store: HashStore = new Map()
    mock.module("@/server/redis/client", () => ({
      getCommandClient: async () => createRedisMock(store),
    }))

    const {
      claimOrVerifyIdentitySecret,
      matchIdentitySecret,
    } = await import("@/server/realtime/services/identity-store")

    const claimed = await claimOrVerifyIdentitySecret({
      roomId: "room-1",
      userId: "user-1",
      userSecret: "plaintext-secret",
    })
    expect(claimed).toBe(true)
    expect(store.get("user-1")?.startsWith("h1:")).toBe(true)
    expect(store.get("user-1")).not.toContain("plaintext-secret")

    const matched = await matchIdentitySecret({
      roomId: "room-1",
      userId: "user-1",
      userSecret: "plaintext-secret",
    })
    expect(matched).toBe(true)

    const rejected = await claimOrVerifyIdentitySecret({
      roomId: "room-1",
      userId: "user-1",
      userSecret: "wrong-secret",
    })
    expect(rejected).toBe(false)
  })

  test("HSETNX first claim wins; race loser verifies against winner", async () => {
    const store: HashStore = new Map()
    let hSetNxCalls = 0
    const redis = {
      ...createRedisMock(store),
      hSetNX: async (_key: string, field: string, value: string) => {
        hSetNxCalls += 1
        if (store.has(field)) return 0
        store.set(field, value)
        return 1
      },
    }
    mock.module("@/server/redis/client", () => ({
      getCommandClient: async () => redis,
    }))

    const { claimOrVerifyIdentitySecret } = await import(
      "@/server/realtime/services/identity-store"
    )

    const first = await claimOrVerifyIdentitySecret({
      roomId: "room-1",
      userId: "user-1",
      userSecret: "winner-secret",
    })
    expect(first).toBe(true)
    expect(hSetNxCalls).toBe(1)
    const winnerHash = store.get("user-1")
    expect(winnerHash?.startsWith("h1:")).toBe(true)

    const loserWrong = await claimOrVerifyIdentitySecret({
      roomId: "room-1",
      userId: "user-1",
      userSecret: "loser-secret",
    })
    expect(loserWrong).toBe(false)
    expect(store.get("user-1")).toBe(winnerHash)
    expect(hSetNxCalls).toBe(2)

    const loserMatch = await claimOrVerifyIdentitySecret({
      roomId: "room-1",
      userId: "user-1",
      userSecret: "winner-secret",
    })
    expect(loserMatch).toBe(true)
    expect(hSetNxCalls).toBe(3)
  })

  test("atomic claim does not overwrite an existing field via HSET", async () => {
    const store: HashStore = new Map()
    let hSetCalled = false
    const redis = {
      ...createRedisMock(store),
      hSet: async () => {
        hSetCalled = true
        return 1
      },
    }
    mock.module("@/server/redis/client", () => ({
      getCommandClient: async () => redis,
    }))

    const { claimOrVerifyIdentitySecret } = await import(
      "@/server/realtime/services/identity-store"
    )

    await claimOrVerifyIdentitySecret({
      roomId: "room-1",
      userId: "user-1",
      userSecret: "first",
    })
    await claimOrVerifyIdentitySecret({
      roomId: "room-1",
      userId: "user-1",
      userSecret: "second",
    })

    // First claim uses HSETNX only; mismatch verify must not HSET a new secret.
    expect(hSetCalled).toBe(false)
    expect(store.get("user-1")?.startsWith("h1:")).toBe(true)
  })

  test("migrates legacy cleartext secrets to hashes", async () => {
    const store: HashStore = new Map([["user-1", "legacy-cleartext"]])
    mock.module("@/server/redis/client", () => ({
      getCommandClient: async () => createRedisMock(store),
    }))

    const { claimOrVerifyIdentitySecret } = await import(
      "@/server/realtime/services/identity-store"
    )

    const ok = await claimOrVerifyIdentitySecret({
      roomId: "room-1",
      userId: "user-1",
      userSecret: "legacy-cleartext",
    })
    expect(ok).toBe(true)
    expect(store.get("user-1")?.startsWith("h1:")).toBe(true)
    expect(store.get("user-1")).not.toBe("legacy-cleartext")
  })

  test("matchIdentitySecret migrates legacy cleartext without claiming", async () => {
    const store: HashStore = new Map([["user-1", "legacy-cleartext"]])
    mock.module("@/server/redis/client", () => ({
      getCommandClient: async () => createRedisMock(store),
    }))

    const { matchIdentitySecret } = await import(
      "@/server/realtime/services/identity-store"
    )

    const ok = await matchIdentitySecret({
      roomId: "room-1",
      userId: "user-1",
      userSecret: "legacy-cleartext",
    })
    expect(ok).toBe(true)
    expect(store.get("user-1")?.startsWith("h1:")).toBe(true)
  })
})
