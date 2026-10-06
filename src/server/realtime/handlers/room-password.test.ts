import { afterEach, describe, expect, test } from "bun:test"
import {
  createTestBroadcastBus,
  setRoomBroadcastBusForTests,
} from "@/server/realtime/broadcast/room-broadcast-bus"
import {
  handleRoomPasswordClear,
  handleRoomPasswordSet,
} from "@/server/realtime/handlers/room-password"
import {
  createHandlerContext,
  createRoomState,
  envelope,
  InMemoryRoomStateStore,
} from "@/server/realtime/test-utils/fixtures"

describe("room password handler interfaces", () => {
  afterEach(() => {
    setRoomBroadcastBusForTests(null)
  })

  test("owner can set and clear join password", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    const ctx = createHandlerContext({ store, userId: "owner" })

    await handleRoomPasswordSet(
      ctx,
      envelope("room:password:set", { password: "hunter2" }),
    )
    let security = store.peek("room-1")?.roomSecurity
    expect(security?.joinPasswordEnabled).toBe(true)
    expect(security?.joinPasswordHash).toBeTruthy()
    expect(security?.joinPasswordSalt).toBeTruthy()

    await handleRoomPasswordClear(ctx, envelope("room:password:clear", {}))
    security = store.peek("room-1")?.roomSecurity
    expect(security?.joinPasswordEnabled).toBe(false)
    expect(security?.joinPasswordHash).toBeUndefined()
  })

  test("non-owner and player session cannot set password", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)

    await handleRoomPasswordSet(
      createHandlerContext({ store, userId: "guest" }),
      envelope("room:password:set", { password: "nope" }),
    )
    expect(store.peek("room-1")?.roomSecurity.joinPasswordEnabled).toBe(false)

    await handleRoomPasswordSet(
      createHandlerContext({
        store,
        userId: "owner",
        sessionKind: "player",
      }),
      envelope("room:password:set", { password: "nope" }),
    )
    expect(store.peek("room-1")?.roomSecurity.joinPasswordEnabled).toBe(false)
  })
})
