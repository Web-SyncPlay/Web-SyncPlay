import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

beforeEach(() => {
  // Reset redis client mock so prior files' partial mocks do not leak.
  mock.module("@/server/redis/client", () => ({
    getCommandClient: async () => ({
      get: async () => null,
      set: async () => "OK",
      del: async () => 0,
    }),
    getSubscriberClient: async () => ({
      subscribe: async () => undefined,
    }),
  }))
})

afterEach(() => {
  mock.restore()
})

describe("resolveServeableLocalMedia", () => {
  test("denies access without viewer token", async () => {
    mock.module("@/server/media/local-media-store", () => ({
      getLocalMediaEntry: async () => ({
        id: "media-1",
        roomId: "room-1",
        ownerUserId: "owner-1",
        providerReady: true,
        sizeBytes: 100,
        mimeType: "video/mp4",
      }),
    }))
    mock.module("@/server/media/viewer-capability-token", () => ({
      validateViewerCapabilityToken: async () => true,
    }))
    mock.module("@/server/redis/state-store", () => ({
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
      getLocalMediaEntry: async () => ({
        id: "media-1",
        roomId: "room-1",
        ownerUserId: "owner-1",
        providerReady: true,
        sizeBytes: 100,
        mimeType: "video/mp4",
      }),
    }))
    mock.module("@/server/media/viewer-capability-token", () => ({
      validateViewerCapabilityToken: async () => false,
    }))
    mock.module("@/server/redis/state-store", () => ({
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
    let validated: {
      token: string
      roomId: string
      userId: string
      clientIp: string
    } | null = null

    mock.module("@/server/media/local-media-store", () => ({
      getLocalMediaEntry: async () => ({
        id: "media-1",
        roomId: "room-1",
        ownerUserId: "owner-1",
        providerReady: true,
        sizeBytes: 100,
        mimeType: "video/mp4",
      }),
    }))
    mock.module("@/server/media/viewer-capability-token", () => ({
      validateViewerCapabilityToken: async (input: {
        token: string
        roomId: string
        userId: string
        clientIp: string
      }) => {
        validated = input
        return true
      },
    }))
    mock.module("@/server/redis/state-store", () => ({
      getRoomStateStore: async () => ({
        getWsPresenceUserIds: async () => new Set(["owner-1"]),
      }),
    }))

    const { resolveServeableLocalMedia } = await import("./local-media-access")

    const ok = await resolveServeableLocalMedia("media-1", {
      viewer: {
        token: "good-token",
        userId: "user-1",
        clientIp: "203.0.113.10",
      },
    })
    expect(ok.ok).toBe(true)
    expect(validated).not.toBeNull()
    expect(validated!).toEqual({
      token: "good-token",
      roomId: "room-1",
      userId: "user-1",
      clientIp: "203.0.113.10",
    })
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
