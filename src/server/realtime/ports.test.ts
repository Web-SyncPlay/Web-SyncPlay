import { describe, expect, test } from "bun:test"
import type { RoomStateStorePort } from "@/server/realtime/ports"
import {
  createRoomState,
  InMemoryRoomStateStore,
} from "@/server/realtime/test-utils/fixtures"

describe("RoomStateStorePort interface", () => {
  test("in-memory adapter fulfills get/update/delete/list/presence", async () => {
    const store: RoomStateStorePort = new InMemoryRoomStateStore(
      createRoomState(),
    )

    const got = await store.get("room-1")
    expect(got?.roomId).toBe("room-1")

    const updated = await store.updateRoom("room-1", (state) => {
      if (!state) return null
      state.currentIndex = 2
      return state
    })
    expect(updated?.currentIndex).toBe(2)

    const aborted = await store.updateRoom("room-1", () => null)
    expect(aborted).toBeNull()
    expect((await store.get("room-1"))?.currentIndex).toBe(2)

    await store.addWsConnectionRef("room-1", "extra")
    expect((await store.getWsPresenceUserIds("room-1")).has("extra")).toBe(true)
    await store.removeWsConnectionRef("room-1", "extra")
    expect((await store.getWsPresenceUserIds("room-1")).has("extra")).toBe(
      false,
    )

    await store.setDailyDefaults([
      { title: "t", url: "https://example.com/t" },
    ])
    expect(await store.getDailyDefaults()).toEqual([
      { title: "t", url: "https://example.com/t" },
    ])

    await store.delete("room-1")
    expect(await store.get("room-1")).toBeNull()
    expect(await store.listRoomIds()).toEqual([])
  })

  test("in-memory adapter merges and clears presence data HASH", async () => {
    const store: RoomStateStorePort = new InMemoryRoomStateStore(
      createRoomState(),
    )

    await store.mergePresenceData("room-1", "u1", {
      localPlayback: {
        updatedAt: 10,
        currentTimeMs: 1,
        paused: false,
        loading: false,
      },
    })
    await store.mergePresenceData("room-1", "u1", {
      localPlayback: {
        updatedAt: 20,
        currentTimeMs: 2,
        paused: true,
        loading: false,
      },
    })
    await store.mergePresenceData("room-1", "u2", { username: "bob" })

    const all = await store.getPresenceDataAll("room-1")
    expect(all.u1?.localPlayback?.updatedAt).toBe(20)
    expect(all.u1?.localPlayback?.paused).toBe(true)
    expect(all.u2?.username).toBe("bob")

    await store.clearPresenceData("room-1")
    expect(await store.getPresenceDataAll("room-1")).toEqual({})
  })

  test("seedDailyDefaultsIfEmpty only fills when empty", async () => {
    const store: RoomStateStorePort = new InMemoryRoomStateStore()
    await store.seedDailyDefaultsIfEmpty()
    const seeded = await store.getDailyDefaults()
    expect(seeded.length).toBeGreaterThan(0)

    await store.setDailyDefaults([{ title: "keep", url: "https://x.test/a" }])
    await store.seedDailyDefaultsIfEmpty()
    expect(await store.getDailyDefaults()).toEqual([
      { title: "keep", url: "https://x.test/a" },
    ])
  })
})
