import { afterEach, describe, expect, mock, test } from "bun:test"

type HashStore = Map<string, string>

function createRedisMock(store: HashStore) {
  return {
    hGet: async (_key: string, field: string) => store.get(field) ?? null,
    hSet: async (_key: string, field: string, value: string) => {
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
})
