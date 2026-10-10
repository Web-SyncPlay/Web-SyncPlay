import { afterEach, describe, expect, mock, test } from "bun:test"
import { keys } from "@/server/redis/keys"
import { createRoomState } from "@/shared/test-utils/room-fixtures"
import type { PresencePatch } from "@/contracts/types"

afterEach(() => {
  mock.restore()
})

/** In-process stand-in for PRESENCE_MERGE_SCRIPT merge semantics. */
function applyPresenceMerge(
  store: Map<string, string>,
  userId: string,
  patchJson: string,
) {
  const patch = JSON.parse(patchJson) as PresencePatch
  const existing = store.has(userId)
    ? ((JSON.parse(store.get(userId)!) as PresencePatch) ?? {})
    : {}
  const merged: PresencePatch = {
    ...existing,
    ...patch,
    localPlayback: patch.localPlayback ?? existing.localPlayback,
    localPlaybackReports:
      patch.localPlaybackReports ?? existing.localPlaybackReports,
  }
  store.set(userId, JSON.stringify(merged))
  return 1
}

describe("RoomStateStore.updateRoom", () => {
  test("throws after WATCH retry exhaustion", async () => {
    let watchCalls = 0
    let unwatchCalls = 0
    mock.module("@/server/redis/client", () => ({
      getCommandClient: async () => ({
        watch: async () => {
          watchCalls += 1
          return "OK"
        },
        unwatch: async () => {
          unwatchCalls += 1
          return "OK"
        },
        get: async () => null,
        multi: () => ({
          set() {
            return this
          },
          async exec() {
            return null
          },
        }),
      }),
    }))

    const { RoomStateStore } = await import("./state-store")
    const store = new RoomStateStore()

    await expect(
      store.updateRoom("room-watch", () => createRoomState({ roomId: "room-watch" })),
    ).rejects.toThrow("updateRoom: WATCH retry exhausted")

    expect(watchCalls).toBe(12)
    expect(unwatchCalls).toBe(12)
  })
})

describe("RoomStateStore.delete lifecycle keys", () => {
  test("deletes all room lifecycle keys", async () => {
    let deleted: string[] | string | undefined
    mock.module("@/server/redis/client", () => ({
      getCommandClient: async () => ({
        del: async (keyOrKeys: string | string[]) => {
          deleted = keyOrKeys
          return Array.isArray(keyOrKeys) ? keyOrKeys.length : 1
        },
      }),
    }))

    const { RoomStateStore, resetTouchWsPresenceThrottleForTests } =
      await import("./state-store")
    resetTouchWsPresenceThrottleForTests()

    const store = new RoomStateStore()
    const roomId = "room-lifecycle"
    await store.delete(roomId)

    expect(deleted).toEqual([
      keys.roomState(roomId),
      keys.roomPresenceRef(roomId),
      keys.roomPresenceData(roomId),
      keys.roomPresenceSeq(roomId),
      keys.roomIdentity(roomId),
    ])
  })
})

describe("RoomStateStore.mergePresenceData", () => {
  test("uses atomic eval and does not clobber unrelated fields", async () => {
    const fieldStore = new Map<string, string>()
    let evalCalls = 0
    let hGetCalls = 0
    let hSetCalls = 0

    mock.module("@/server/redis/client", () => ({
      getCommandClient: async () => ({
        eval: async (
          script: string,
          opts: { keys: string[]; arguments: string[] },
        ) => {
          evalCalls += 1
          expect(script).toContain("HGET")
          expect(script).toContain("localPlayback")
          expect(opts.keys).toEqual([keys.roomPresenceData("room-merge")])
          expect(opts.arguments[0]).toBe("user-1")
          expect(opts.arguments.length).toBe(3)
          return applyPresenceMerge(
            fieldStore,
            opts.arguments[0]!,
            opts.arguments[1]!,
          )
        },
        hGet: async () => {
          hGetCalls += 1
          return null
        },
        hSet: async () => {
          hSetCalls += 1
          return 1
        },
        hGetAll: async () => Object.fromEntries(fieldStore),
        expire: async () => true,
      }),
    }))

    const { RoomStateStore } = await import("./state-store")
    const store = new RoomStateStore()

    // Concurrent-style sequential patches: each must merge onto the latest.
    await store.mergePresenceData("room-merge", "user-1", {
      username: "alice",
    })
    await store.mergePresenceData("room-merge", "user-1", {
      connected: true,
      lastSeenAt: 100,
    })
    await store.mergePresenceData("room-merge", "user-1", {
      localPlayback: {
        updatedAt: 1,
        currentTimeMs: 50,
        paused: false,
        loading: false,
      },
    })
    // Username-only patch must keep localPlayback (?? semantics).
    await store.mergePresenceData("room-merge", "user-1", {
      username: "alice-renamed",
    })
    await store.mergePresenceData("room-merge", "user-1", {
      localPlaybackReports: {
        "conn-a": {
          sessionKind: "player",
          updatedAt: 2,
          currentTimeMs: 60,
          paused: true,
          loading: false,
        },
      },
    })
    // localPlaybackReports omitted → preserved; localPlayback replaced.
    await store.mergePresenceData("room-merge", "user-1", {
      localPlayback: {
        updatedAt: 3,
        currentTimeMs: 70,
        paused: true,
        loading: false,
      },
    })

    expect(evalCalls).toBe(6)
    expect(hGetCalls).toBe(0)
    expect(hSetCalls).toBe(0)

    const all = await store.getPresenceDataAll("room-merge")
    expect(all["user-1"]).toEqual({
      username: "alice-renamed",
      connected: true,
      lastSeenAt: 100,
      localPlayback: {
        updatedAt: 3,
        currentTimeMs: 70,
        paused: true,
        loading: false,
      },
      localPlaybackReports: {
        "conn-a": {
          sessionKind: "player",
          updatedAt: 2,
          currentTimeMs: 60,
          paused: true,
          loading: false,
        },
      },
    })
  })
})

describe("RoomStateStore presence read vs reconcile", () => {
  test("readWsPresenceUserIds does not hSet/hDel; reconcilePresenceRefs cleans stale", async () => {
    const { getAppNodeId } = await import("@/server/node-id")
    const nodeId = getAppNodeId()
    const deadNode = "dead-node"
    const hash = new Map<string, string>([
      ["live", JSON.stringify({ [nodeId]: 1 })],
      ["stale", JSON.stringify({ [deadNode]: 1 })],
      ["legacy", "2"],
      [
        "mixed",
        JSON.stringify({ [nodeId]: 1, [deadNode]: 2 }),
      ],
    ])
    let hSetCalls = 0
    let hDelCalls = 0

    mock.module("@/server/node-heartbeat", () => ({
      listAliveAppNodeIds: async () => ({
        ids: new Set([nodeId]),
        reliable: true,
      }),
    }))
    mock.module("@/server/redis/client", () => ({
      getCommandClient: async () => ({
        hGetAll: async () => Object.fromEntries(hash),
        hSet: async (
          _key: string,
          fields: Record<string, string>,
        ) => {
          hSetCalls += 1
          for (const [uid, encoded] of Object.entries(fields)) {
            hash.set(uid, encoded)
          }
          return 1
        },
        hDel: async (_key: string, fields: string[]) => {
          hDelCalls += 1
          for (const uid of fields) hash.delete(uid)
          return fields.length
        },
      }),
    }))

    const { RoomStateStore } = await import("./state-store")
    const store = new RoomStateStore()

    const online = await store.readWsPresenceUserIds("room-presence")
    expect([...online].sort()).toEqual(["live", "mixed"])
    expect(hSetCalls).toBe(0)
    expect(hDelCalls).toBe(0)
    expect(hash.has("stale")).toBe(true)
    expect(hash.has("legacy")).toBe(true)

    await store.reconcilePresenceRefs("room-presence")
    expect(hDelCalls).toBe(1)
    expect(hSetCalls).toBe(1)
    expect(hash.has("stale")).toBe(false)
    expect(hash.has("legacy")).toBe(false)
    expect(hash.get("mixed")).toBe(JSON.stringify({ [nodeId]: 1 }))
  })
})
