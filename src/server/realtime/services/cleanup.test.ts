import { afterEach, expect, mock, test } from "bun:test"
import { setRoomBroadcastBusForTests } from "@/server/realtime/broadcast/room-broadcast-bus"
import type { RoomState } from "@/contracts/types"

afterEach(() => {
  mock.restore()
  setRoomBroadcastBusForTests(null)
})

function createState(): RoomState {
  return {
    roomId: "room-1",
    ownerId: "owner",
    roomSecurity: {
      joinPasswordEnabled: false,
      joinPasswordUpdatedAt: null,
      admissionVersion: 0,
      defaultJoinRole: "moderator",
    },
    playback: {
      paused: true,
      playbackRate: 1,
      timelineAnchorMs: 0,
      serverNowMs: Date.now(),
      videoLoop: "off",
      playlistLoop: "off",
    },
    playlist: [],
    currentIndex: 0,
    participants: {
      owner: {
        userId: "owner",
        username: "Owner",
        avatarStyle: "adventurer",
        role: "owner",
        connected: true,
        joinedAt: 1,
        localPlayback: {
          paused: true,
          currentTimeMs: 0,
          loading: false,
          updatedAt: Date.now(),
        },
      },
      mod: {
        userId: "mod",
        username: "Mod",
        avatarStyle: "adventurer",
        role: "moderator",
        connected: true,
        joinedAt: 2,
        localPlayback: {
          paused: true,
          currentTimeMs: 0,
          loading: false,
          updatedAt: Date.now(),
        },
      },
    },
    actionLog: [],
    updatedAt: Date.now(),
    generation: 0,
    structuralRevision: 0,
  }
}

function mockRedisPruneIndex(options?: {
  /** Members returned by processDuePrunes sMembers (after cleanup enqueue). */
  pendingMembers?: string[]
}) {
  const pending = new Set<string>(options?.pendingMembers ?? [])
  const grace = new Map<string, string>()

  mock.module("@/server/redis/client", () => ({
    getCommandClient: async () => ({
      set: async (key: string, _value: string) => {
        grace.set(key, "1")
        return "OK"
      },
      get: async (key: string) => grace.get(key) ?? null,
      del: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          grace.delete(key)
        }
        return 1
      },
      sAdd: async (_key: string, member: string) => {
        pending.add(member)
        return 1
      },
      sRem: async (_key: string, members: string | string[]) => {
        for (const member of Array.isArray(members) ? members : [members]) {
          pending.delete(member)
        }
        return 1
      },
      sMembers: async () => [...pending],
      expire: async () => 1,
    }),
  }))

  return { pending, grace }
}

function createCleanupStore(options: {
  state: RoomState
  presence: Set<string>
  get?: () => Promise<RoomState | null>
  onDelete?: () => void
  trackPresenceDuringMutate?: {
    readCalls: number[]
    reconcileCalls: number[]
    duringMutate: boolean
  }
}) {
  const track = options.trackPresenceDuringMutate
  return {
    listRoomIds: async () => ["room-1"],
    get: options.get ?? (async () => options.state),
    delete: async () => {
      options.onDelete?.()
    },
    readWsPresenceUserIds: async () => {
      track?.readCalls.push(1)
      if (track?.duringMutate) {
        throw new Error("readWsPresenceUserIds called inside updateRoom mutate")
      }
      return options.presence
    },
    reconcilePresenceRefs: async () => {
      track?.reconcileCalls.push(1)
      if (track?.duringMutate) {
        throw new Error("reconcilePresenceRefs called inside updateRoom mutate")
      }
    },
    updateRoom: async (
      roomId: string,
      mutate: (
        current: RoomState | null,
      ) => Promise<RoomState | null> | RoomState | null,
    ) => {
      if (track) track.duringMutate = true
      const next = await mutate(roomId === "room-1" ? options.state : null)
      if (track) track.duringMutate = false
      if (next) {
        Object.assign(options.state, next)
      }
      return next
    },
  }
}

test("cleanup reassigns owner when owner loses presence (grace keeps participant)", async () => {
  mockRedisPruneIndex()
  const { cleanupInactiveRooms: cleanup } = await import("./cleanup")
  const state = createState()

  await cleanup(
    createCleanupStore({
      state,
      presence: new Set(["mod"]),
    }) as never,
  )

  expect(state.ownerId).toBe("mod")
  expect(state.participants.mod?.role).toBe("owner")
  expect(state.participants.owner?.connected).toBe(false)
  expect(state.participants.owner).toBeDefined()
})

test("cleanup removes participants past prune grace via Redis prune path", async () => {
  mockRedisPruneIndex()
  const { cleanupInactiveRooms: cleanup } = await import("./cleanup")
  const state = createState()
  const owner = state.participants.owner
  if (owner) {
    owner.connected = false
    owner.disconnectedAt = Date.now() - 120_000
  }

  const result = await cleanup(
    createCleanupStore({
      state,
      presence: new Set(["mod"]),
    }) as never,
  )

  expect(result.removedParticipants).toBe(1)
  expect(state.participants.owner).toBeUndefined()
  expect(state.ownerId).toBe("mod")
})

test("cleanup marks everyone offline when WS presence is empty (crash ghosts)", async () => {
  mockRedisPruneIndex()
  const { cleanupInactiveRooms: cleanup } = await import("./cleanup")
  const state = createState()
  let deleted = false
  let deletedDuringMutate = false
  const track = { readCalls: [] as number[], reconcileCalls: [] as number[], duringMutate: false }

  const fakeStore = createCleanupStore({
    state,
    presence: new Set(),
    onDelete: () => {
      deleted = true
    },
    trackPresenceDuringMutate: track,
  })
  const originalUpdate = fakeStore.updateRoom
  fakeStore.updateRoom = async (roomId, mutate) => {
    const next = await originalUpdate(roomId, mutate)
    if (deleted) deletedDuringMutate = true
    return next
  }

  await cleanup(fakeStore as never)

  expect(state.participants.owner?.connected).toBe(false)
  expect(state.participants.mod?.connected).toBe(false)
  expect(deleted).toBe(false)
  expect(deletedDuringMutate).toBe(false)
})

test("cleanup destroys empty rooms after WATCH mutate returns", async () => {
  mockRedisPruneIndex()
  const { cleanupInactiveRooms: cleanup } = await import("./cleanup")
  const state = createState()
  state.participants = {}
  let deleted = false
  let deletedDuringMutate = false

  const fakeStore = createCleanupStore({
    state,
    presence: new Set(),
    get: async () => null,
    onDelete: () => {
      deleted = true
    },
  })
  const originalUpdate = fakeStore.updateRoom
  fakeStore.updateRoom = async (roomId, mutate) => {
    const next = await originalUpdate(roomId, async (current) => {
      const result = await mutate(current)
      if (deleted) deletedDuringMutate = true
      return result
    })
    return next
  }

  const result = await cleanup(fakeStore as never)

  expect(deletedDuringMutate).toBe(false)
  expect(deleted).toBe(true)
  expect(result.removedRooms).toBe(1)
})

test("cleanup migrates legacy room fields without waiting for join", async () => {
  mockRedisPruneIndex()
  const { cleanupInactiveRooms: cleanup } = await import("./cleanup")
  const state = createState()
  const legacy = state as RoomState & { history?: unknown }
  legacy.history = [{ at: 1 }]
  ;(
    state.playback as typeof state.playback & { shuffle?: unknown }
  ).shuffle = true

  await cleanup(
    createCleanupStore({
      state,
      presence: new Set(["owner", "mod"]),
    }) as never,
  )

  expect(legacy.history).toBeUndefined()
  expect(
    (state.playback as { shuffle?: unknown }).shuffle,
  ).toBeUndefined()
})

test("cleanup fetches and reconciles presence before updateRoom, not inside mutate", async () => {
  mockRedisPruneIndex()
  const { cleanupInactiveRooms: cleanup } = await import("./cleanup")
  const state = createState()
  const callOrder: string[] = []
  const track = {
    readCalls: [] as number[],
    reconcileCalls: [] as number[],
    duringMutate: false,
  }

  const fakeStore = createCleanupStore({
    state,
    presence: new Set(["owner", "mod"]),
    trackPresenceDuringMutate: track,
  })
  const read = fakeStore.readWsPresenceUserIds
  const reconcile = fakeStore.reconcilePresenceRefs
  const update = fakeStore.updateRoom
  fakeStore.readWsPresenceUserIds = async () => {
    callOrder.push("read")
    return read()
  }
  fakeStore.reconcilePresenceRefs = async () => {
    callOrder.push("reconcile")
    return reconcile()
  }
  fakeStore.updateRoom = async (roomId, mutate) => {
    callOrder.push("updateRoom")
    return update(roomId, mutate)
  }

  await cleanup(fakeStore as never)

  expect(callOrder).toEqual(["read", "reconcile", "updateRoom"])
  expect(track.readCalls.length).toBe(1)
  expect(track.reconcileCalls.length).toBe(1)
})
