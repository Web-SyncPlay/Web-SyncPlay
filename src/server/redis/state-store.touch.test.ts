import { afterEach, describe, expect, mock, test } from "bun:test"
import { keys } from "@/server/redis/keys"
import { roomStateTtlSeconds } from "@/contracts/types"

afterEach(() => {
  mock.restore()
})

describe("RoomStateStore.touchWsPresence throttle", () => {
  test("refreshes lifecycle TTLs at most once per ~45s unless forced", async () => {
    const expireCalls: string[] = []
    mock.module("@/server/redis/client", () => ({
      getCommandClient: async () => ({
        multi: () => {
          const queued: string[] = []
          return {
            expire(key: string) {
              queued.push(key)
              return this
            },
            async exec() {
              expireCalls.push(...queued)
              return queued.map(() => 1)
            },
          }
        },
      }),
    }))

    const {
      RoomStateStore,
      resetTouchWsPresenceThrottleForTests,
    } = await import("./state-store")
    resetTouchWsPresenceThrottleForTests()

    const store = new RoomStateStore()
    const roomId = "room-touch"
    const lifecycle = [
      keys.roomState(roomId),
      keys.roomPresenceRef(roomId),
      keys.roomPresenceData(roomId),
      keys.roomPresenceSeq(roomId),
      keys.roomIdentity(roomId),
    ]

    await store.touchWsPresence(roomId, "user-a")
    expect(expireCalls).toEqual(lifecycle)

    expireCalls.length = 0
    await store.touchWsPresence(roomId, "user-a")
    await store.touchWsPresence(roomId, "user-b")
    expect(expireCalls).toEqual([])

    await store.touchWsPresence(roomId, "user-a", { force: true })
    expect(expireCalls).toEqual(lifecycle)
    expect(roomStateTtlSeconds).toBeGreaterThan(0)
  })
})
