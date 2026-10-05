import { describe, expect, test } from "bun:test"
import type { RoomStateStorePort } from "@/server/realtime/ports"
import { InMemoryRoomStateStore } from "@/server/realtime/test-utils/fixtures"
import { createRoomState } from "@/server/realtime/test-utils/fixtures"

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
})
