import { markProcessDraining, resetLifecycleForTests } from "@/server/lifecycle"
import { keys } from "@/server/redis/keys"
import { EMPTY_ROOM_DESTROY_GRACE_MS } from "@/shared/room-lifecycle"
import { afterEach, describe, expect, mock, test } from "bun:test"

afterEach(() => {
  mock.restore()
  resetLifecycleForTests({ exitProcess: false })
})

function mockEmptyAtStore(initial?: Map<string, string>) {
  const store = initial ?? new Map<string, string>()
  mock.module("@/server/redis/client", () => ({
    getCommandClient: async () => ({
      set: async (key: string, value: string, opts?: { NX?: boolean }) => {
        if (opts?.NX && store.has(key)) return null
        store.set(key, value)
        return "OK"
      },
      get: async (key: string) => store.get(key) ?? null,
      del: async (key: string) => {
        store.delete(key)
        return 1
      },
    }),
  }))
  return store
}

describe("empty-room grace", () => {
  test("mark NX then clear; grace not elapsed immediately", async () => {
    mockEmptyAtStore()
    const {
      markRoomEmptyIfAbsent,
      clearRoomEmptyMarker,
      isEmptyRoomGraceElapsed,
    } = await import("./empty-room")

    const now = Date.now()
    await markRoomEmptyIfAbsent("room-a", now)
    expect(await isEmptyRoomGraceElapsed("room-a", now + 1_000)).toBe(false)

    await clearRoomEmptyMarker("room-a")
    expect(await isEmptyRoomGraceElapsed("room-a", now + 60_000)).toBe(false)
  })

  test("grace elapsed after EMPTY_ROOM_DESTROY_GRACE_MS", async () => {
    const store = mockEmptyAtStore()
    const emptyAt = Date.now() - EMPTY_ROOM_DESTROY_GRACE_MS - 500
    store.set(keys.roomEmptyAt("room-b"), String(emptyAt))

    const { isEmptyRoomGraceElapsed, noteEmptyPresenceAndShouldDestroy } =
      await import("./empty-room")

    expect(await isEmptyRoomGraceElapsed("room-b")).toBe(true)
    expect(await noteEmptyPresenceAndShouldDestroy("room-b")).toBe(true)
  })

  test("draining process never destroys", async () => {
    const store = mockEmptyAtStore()
    store.set(
      keys.roomEmptyAt("room-c"),
      String(Date.now() - EMPTY_ROOM_DESTROY_GRACE_MS - 1_000),
    )
    markProcessDraining()

    const { noteEmptyPresenceAndShouldDestroy } = await import("./empty-room")
    expect(await noteEmptyPresenceAndShouldDestroy("room-c")).toBe(false)
  })
})
