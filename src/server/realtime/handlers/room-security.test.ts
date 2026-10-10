import { afterEach, describe, expect, test } from "bun:test"
import {
  createTestBroadcastBus,
  setRoomBroadcastBusForTests,
} from "@/server/realtime/broadcast/room-broadcast-bus"
import {
  handleRoomDefaultRoleSet,
  handleRoomPasswordClear,
  handleRoomPasswordSet,
} from "@/server/realtime/handlers/room-security"
import {
  createFakeWs,
  createHandlerContext,
  createRoomState,
  envelope,
  InMemoryRoomStateStore,
} from "@/server/realtime/test-utils/fixtures"
import { addSocket, removeSocket } from "@/server/ws/registry"

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

  test("password set kicks non-owners and publishes admission:changed", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    const bus = createTestBroadcastBus(store)

    const owner = createFakeWs()
    const guest = createFakeWs()
    const mod = createFakeWs()
    addSocket(owner.ws, {
      roomId: "room-1",
      userId: "owner",
      controlAuthorized: true,
      isControlSession: true,
      sessionKind: "room",
    })
    addSocket(guest.ws, {
      roomId: "room-1",
      userId: "guest",
      controlAuthorized: false,
      isControlSession: false,
      sessionKind: "room",
    })
    addSocket(mod.ws, {
      roomId: "room-1",
      userId: "mod",
      controlAuthorized: true,
      isControlSession: false,
      sessionKind: "room",
    })

    try {
      await handleRoomPasswordSet(
        createHandlerContext({ store, userId: "owner", ws: owner.ws }),
        envelope("room:password:set", { password: "hunter2" }),
      )

      expect(owner.closed).toBe(false)
      expect(guest.closed).toBe(true)
      expect(mod.closed).toBe(true)

      const admission = guest.sent.find(
        (m) => (m as { type?: string }).type === "room:admission:changed",
      ) as
        | {
            type: string
            payload: {
              ownerId: string
              joinPasswordEnabled: boolean
              admissionVersion: number
            }
          }
        | undefined
      expect(admission?.payload.ownerId).toBe("owner")
      expect(admission?.payload.joinPasswordEnabled).toBe(true)
      expect(admission?.payload.admissionVersion).toBe(1)

      expect(
        bus.captured.some((c) => c.envelope.type === "room:admission:changed"),
      ).toBe(true)
      expect(
        owner.sent.some(
          (m) => (m as { type?: string }).type === "room:admission:changed",
        ),
      ).toBe(false)
    } finally {
      removeSocket(owner.ws)
      removeSocket(guest.ws)
      removeSocket(mod.ws)
    }
  })

  test("password clear kicks non-owners with joinPasswordEnabled false", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    const owner = createFakeWs()
    const guest = createFakeWs()
    addSocket(owner.ws, {
      roomId: "room-1",
      userId: "owner",
      controlAuthorized: true,
      isControlSession: true,
      sessionKind: "room",
    })
    addSocket(guest.ws, {
      roomId: "room-1",
      userId: "guest",
      controlAuthorized: false,
      isControlSession: false,
      sessionKind: "room",
    })

    try {
      const ctx = createHandlerContext({ store, userId: "owner", ws: owner.ws })
      await handleRoomPasswordSet(
        ctx,
        envelope("room:password:set", { password: "hunter2" }),
      )
      // Re-register guest after first kick.
      const guest2 = createFakeWs()
      addSocket(guest2.ws, {
        roomId: "room-1",
        userId: "guest",
        controlAuthorized: false,
        isControlSession: false,
        sessionKind: "room",
      })

      await handleRoomPasswordClear(ctx, envelope("room:password:clear", {}))
      expect(owner.closed).toBe(false)
      expect(guest2.closed).toBe(true)
      const admission = guest2.sent.find(
        (m) => (m as { type?: string }).type === "room:admission:changed",
      ) as { payload: { joinPasswordEnabled: boolean } } | undefined
      expect(admission?.payload.joinPasswordEnabled).toBe(false)
      removeSocket(guest2.ws)
    } finally {
      removeSocket(owner.ws)
      removeSocket(guest.ws)
    }
  })

  test("default role change does not kick non-owners", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    const guest = createFakeWs()
    addSocket(guest.ws, {
      roomId: "room-1",
      userId: "guest",
      controlAuthorized: false,
      isControlSession: false,
      sessionKind: "room",
    })

    try {
      await handleRoomDefaultRoleSet(
        createHandlerContext({ store, userId: "owner" }),
        envelope("room:default-role:set", { role: "moderator" }),
      )
      expect(guest.closed).toBe(false)
      expect(
        guest.sent.some(
          (m) => (m as { type?: string }).type === "room:admission:changed",
        ),
      ).toBe(false)
    } finally {
      removeSocket(guest.ws)
    }
  })

  test("owner can change default join role", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    const ctx = createHandlerContext({ store, userId: "owner" })

    expect(store.peek("room-1")?.roomSecurity.defaultJoinRole).toBe("guest")

    await handleRoomDefaultRoleSet(
      ctx,
      envelope("room:default-role:set", { role: "moderator" }),
    )
    expect(store.peek("room-1")?.roomSecurity.defaultJoinRole).toBe("moderator")

    await handleRoomDefaultRoleSet(
      createHandlerContext({ store, userId: "guest" }),
      envelope("room:default-role:set", { role: "guest" }),
    )
    expect(store.peek("room-1")?.roomSecurity.defaultJoinRole).toBe("moderator")
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
