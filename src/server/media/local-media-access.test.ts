import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

// Capture real exports before this file's partial `mock.module` overrides.
// Bun's mock.module is process-sticky; restore after each test so later files
// are not poisoned by incomplete export surfaces.
const localMediaStoreActual = await import("@/server/media/local-media-store")
const stateStoreActual = await import("@/server/redis/state-store")

type KvStore = Map<string, { value: string; ex?: number }>

function mockRedisClient(store: KvStore) {
  const redis = {
    set: async (key: string, value: string, opts?: { EX?: number }) => {
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
  mock.module("@/server/redis/client", () => ({
    getCommandClient: async () => redis,
    getSubscriberClient: async () => redis,
  }))
}

beforeEach(() => {
  mockRedisClient(new Map())
})

afterEach(() => {
  mock.module("@/server/media/local-media-store", () => localMediaStoreActual)
  mock.module("@/server/redis/state-store", () => stateStoreActual)
  mock.restore()
})

describe("resolveServeableLocalMedia", () => {
  test("denies access without viewer token", async () => {
    mock.module("@/server/media/local-media-store", () => ({
      ...localMediaStoreActual,
      getLocalMediaEntry: async () => ({
        id: "media-1",
        roomId: "room-1",
        ownerUserId: "owner-1",
        providerReady: true,
        sizeBytes: 100,
        mimeType: "video/mp4",
      }),
    }))
    mock.module("@/server/redis/state-store", () => ({
      ...stateStoreActual,
      getRoomStateStore: async () => ({
        getWsPresenceUserIds: async () => new Set(["owner-1"]),
      }),
    }))

    const { resolveServeableLocalMedia } = await import("./local-media-access")

    const denied = await resolveServeableLocalMedia("media-1", {
      viewer: { token: "", userId: "user-1", clientIp: "203.0.113.10" },
    })
    expect(denied.ok).toBe(false)
    if (!denied.ok) {
      expect(denied.response.status).toBe(403)
      const body = (await denied.response.json()) as { code?: string }
      expect(body.code).toBe("viewer_capability_denied")
    }
  })

  test("denies when capability validation fails", async () => {
    mock.module("@/server/media/local-media-store", () => ({
      ...localMediaStoreActual,
      getLocalMediaEntry: async () => ({
        id: "media-1",
        roomId: "room-1",
        ownerUserId: "owner-1",
        providerReady: true,
        sizeBytes: 100,
        mimeType: "video/mp4",
      }),
    }))
    mock.module("@/server/redis/state-store", () => ({
      ...stateStoreActual,
      getRoomStateStore: async () => ({
        getWsPresenceUserIds: async () => new Set(["owner-1"]),
      }),
    }))

    const { resolveServeableLocalMedia } = await import("./local-media-access")

    const denied = await resolveServeableLocalMedia("media-1", {
      viewer: {
        token: "bad-token",
        userId: "user-1",
        clientIp: "203.0.113.10",
      },
    })
    expect(denied.ok).toBe(false)
    if (!denied.ok) {
      expect(denied.response.status).toBe(403)
    }
  })

  test("allows when token validates and owner is ready", async () => {
    const store: KvStore = new Map()
    mockRedisClient(store)

    mock.module("@/server/media/local-media-store", () => ({
      ...localMediaStoreActual,
      getLocalMediaEntry: async () => ({
        id: "media-1",
        roomId: "room-1",
        ownerUserId: "owner-1",
        providerReady: true,
        sizeBytes: 100,
        mimeType: "video/mp4",
      }),
    }))
    mock.module("@/server/redis/state-store", () => ({
      ...stateStoreActual,
      getRoomStateStore: async () => ({
        getWsPresenceUserIds: async () => new Set(["owner-1"]),
      }),
    }))

    // Use the real mint/validate path so this file never stubs
    // viewer-capability-token (partial mocks leak across Bun test files).
    const { mintViewerCapabilityToken } = await import(
      "./viewer-capability-token"
    )
    const { token } = await mintViewerCapabilityToken({
      roomId: "room-1",
      userId: "user-1",
      boundIp: "203.0.113.10",
    })

    const { resolveServeableLocalMedia } = await import("./local-media-access")

    const ok = await resolveServeableLocalMedia("media-1", {
      viewer: {
        token,
        userId: "user-1",
        clientIp: "203.0.113.10",
      },
    })
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.entry.id).toBe("media-1")
    }
  })

  test("viewerAuthFromLocalMediaRequest reads vt, uid, and client IP", async () => {
    const { viewerAuthFromLocalMediaRequest } = await import(
      "./local-media-access"
    )
    const request = new Request(
      "https://app.test/api/media/local/m1?vt=tok&uid=u1",
      { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } },
    )
    expect(viewerAuthFromLocalMediaRequest(request)).toEqual({
      token: "tok",
      userId: "u1",
      clientIp: "203.0.113.9",
    })
  })
})
