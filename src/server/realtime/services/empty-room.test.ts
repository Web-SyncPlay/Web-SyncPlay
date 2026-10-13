import { markProcessDraining, resetLifecycleForTests } from "@/server/lifecycle"
import { keys } from "@/server/redis/keys"
import { EMPTY_ROOM_DESTROY_GRACE_MS } from "@/shared/room-lifecycle"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  clearRoomEmptyMarker,
  isEmptyRoomGraceElapsed,
  markRoomEmptyIfAbsent,
  noteEmptyPresenceAndShouldDestroy,
  setEmptyAtClientForTests,
  setNoteEmptyPresenceForTests,
} from "./empty-room"

function installMemoryEmptyAtStore(initial?: Map<string, string>) {
  const store = initial ?? new Map<string, string>()
  setEmptyAtClientForTests({
    set: async (key, value, opts) => {
      if (opts?.NX && store.has(key)) return null
      store.set(key, value)
      return "OK"
    },
    get: async (key) => store.get(key) ?? null,
    del: async (key) => {
      store.delete(key)
      return 1
    },
  })
  return store
}

beforeEach(() => {
  setNoteEmptyPresenceForTests(null)
  resetLifecycleForTests({ exitProcess: false })
})

afterEach(() => {
  setEmptyAtClientForTests(null)
  setNoteEmptyPresenceForTests(null)
  resetLifecycleForTests({ exitProcess: false })
})

describe("empty-room grace", () => {
  test("mark NX then clear; grace not elapsed immediately", async () => {
    installMemoryEmptyAtStore()

    const now = Date.now()
    await markRoomEmptyIfAbsent("room-a", now)
    expect(await isEmptyRoomGraceElapsed("room-a", now + 1_000)).toBe(false)

    await clearRoomEmptyMarker("room-a")
    expect(await isEmptyRoomGraceElapsed("room-a", now + 60_000)).toBe(false)
  })

  test("grace elapsed after EMPTY_ROOM_DESTROY_GRACE_MS", async () => {
    const store = installMemoryEmptyAtStore()
    const emptyAt = Date.now() - EMPTY_ROOM_DESTROY_GRACE_MS - 500
    store.set(keys.roomEmptyAt("room-b"), String(emptyAt))

    expect(await isEmptyRoomGraceElapsed("room-b")).toBe(true)
    expect(await noteEmptyPresenceAndShouldDestroy("room-b")).toBe(true)
  })

  test("draining process never destroys", async () => {
    const store = installMemoryEmptyAtStore()
    store.set(
      keys.roomEmptyAt("room-c"),
      String(Date.now() - EMPTY_ROOM_DESTROY_GRACE_MS - 1_000),
    )
    markProcessDraining()

    expect(await noteEmptyPresenceAndShouldDestroy("room-c")).toBe(false)
  })
})
