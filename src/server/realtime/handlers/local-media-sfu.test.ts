import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { getAppNodeId } from "@/server/node-id"
import type { LocalMediaSfuPort } from "@/server/media/local-media-sfu-port"
import {
  setLocalMediaSfuPort,
} from "@/server/realtime/ports"
import {
  createFakeWs,
  createHandlerContext,
  createRoomState,
  envelope,
  InMemoryRoomStateStore,
} from "@/server/realtime/test-utils/fixtures"
import { addSocket, removeSocket } from "@/server/ws/registry"

const closedProducerIds: string[] = []
let produceShouldListThrow = false
let mockProviderNodeId: string | undefined

function createTestSfuPort(): LocalMediaSfuPort {
  return {
    async ensureRuntime() {
      return true
    },
    async createRouter() {
      return {
        roomKey: "room-1",
        routerId: "router-1",
        rtpCapabilities: { codecs: [] },
      }
    },
    async createTransport() {
      return {
        id: "transport-1",
        iceParameters: {} as never,
        iceCandidates: [],
        dtlsParameters: {} as never,
        sctpParameters: {} as never,
      }
    },
    async connectTransport() {
      return { ok: true as const }
    },
    async produceData() {
      return { id: "producer-failed" }
    },
    async consumeData() {
      return {
        id: "consumer-1",
        dataProducerId: "producer-1",
        sctpStreamParameters: undefined,
        label: "",
        protocol: "",
      }
    },
    closeTransport() {},
    onTransportClosed() {},
    getTransportAppData(transportId) {
      return transportId === "transport-1"
        ? { roomKey: "room-1", direction: "send" as const }
        : null
    },
    getDataProducerAppData() {
      return null
    },
    getProviderProducer() {
      return null
    },
    listProviderProducers() {
      return []
    },
    listRequestProducers() {
      if (produceShouldListThrow) {
        throw new Error("list_failed")
      }
      return []
    },
    closeDataProducer(producerId) {
      closedProducerIds.push(producerId)
    },
    assertProviderNodeAffinity(providerNodeId) {
      if (
        typeof providerNodeId === "string" &&
        providerNodeId.length > 0 &&
        providerNodeId !== getAppNodeId()
      ) {
        throw new Error("sfu_wrong_node")
      }
    },
  }
}

mock.module("@/server/media/local-media-store", () => ({
  getLocalMediaEntry: async (localMediaId: string) => ({
    id: localMediaId,
    localMediaId,
    roomId: "room-1",
    ownerUserId: "owner",
    providerNodeId: mockProviderNodeId,
  }),
}))

const sfu = await import("@/server/realtime/handlers/local-media-sfu")

beforeEach(() => {
  closedProducerIds.length = 0
  produceShouldListThrow = false
  mockProviderNodeId = undefined
  setLocalMediaSfuPort(createTestSfuPort())
})

afterEach(() => {
  setLocalMediaSfuPort(null)
})

afterAll(() => {
  mock.restore()
})

describe("local-media-sfu handlers", () => {
  test("capabilities replies invalid_payload on non-object payload", async () => {
    const { ws, sent } = createFakeWs()
    const store = new InMemoryRoomStateStore(createRoomState())
    const ctx = createHandlerContext({ store, ws, userId: "owner" })

    await sfu.handleLocalMediaSfuCapabilities(ctx, {
      type: "local-media:sfu:capabilities",
      payload: "not-an-object" as unknown as Record<string, unknown>,
      requestId: "req-caps",
    })

    expect(sent).toEqual([
      {
        type: "local-media:sfu:result",
        requestId: "req-caps",
        payload: { ok: false, error: "invalid_payload" },
      },
    ])
  })

  test("produce error closes only the failed producer id", async () => {
    produceShouldListThrow = true
    const mediaId = "11111111-1111-4111-8111-111111111111"
    const { ws, sent } = createFakeWs()
    ;(ws as { once: (event: string, cb: () => void) => void }).once = () => {}
    const store = new InMemoryRoomStateStore(createRoomState())
    const ctx = createHandlerContext({ store, ws, userId: "owner" })

    await sfu.handleLocalMediaSfuCreateTransport(
      ctx,
      envelope("local-media:sfu:create-transport", { direction: "send" }),
    )
    expect(sent.at(-1)).toMatchObject({
      payload: { ok: true, id: "transport-1" },
    })

    await sfu.handleLocalMediaSfuProduceData(
      ctx,
      envelope("local-media:sfu:produce-data", {
        transportId: "transport-1",
        localMediaId: mediaId,
        sctpStreamParameters: { streamId: 0 },
        role: "provider",
      }),
    )

    expect(closedProducerIds).toEqual(["producer-failed"])
    expect(sent.at(-1)).toMatchObject({
      type: "local-media:sfu:result",
      payload: { ok: false, error: "list_failed" },
    })
  })

  test("produce refuses when providerNodeId is on another replica", async () => {
    mockProviderNodeId = "other-node"
    const mediaId = "11111111-1111-4111-8111-111111111111"
    const { ws, sent } = createFakeWs()
    ;(ws as { once: (event: string, cb: () => void) => void }).once = () => {}
    const store = new InMemoryRoomStateStore(createRoomState())
    const ctx = createHandlerContext({ store, ws, userId: "owner" })

    await sfu.handleLocalMediaSfuCreateTransport(
      ctx,
      envelope("local-media:sfu:create-transport", { direction: "send" }),
    )
    await sfu.handleLocalMediaSfuProduceData(
      ctx,
      envelope("local-media:sfu:produce-data", {
        transportId: "transport-1",
        localMediaId: mediaId,
        sctpStreamParameters: { streamId: 0 },
        role: "provider",
      }),
    )

    expect(sent.at(-1)).toMatchObject({
      type: "local-media:sfu:result",
      payload: { ok: false, error: "sfu_wrong_node" },
    })

    mockProviderNodeId = getAppNodeId()
    await sfu.handleLocalMediaSfuProduceData(
      ctx,
      envelope("local-media:sfu:produce-data", {
        transportId: "transport-1",
        localMediaId: mediaId,
        sctpStreamParameters: { streamId: 0 },
        role: "provider",
      }),
    )
    expect(sent.at(-1)).toMatchObject({
      payload: { ok: true, id: "producer-failed" },
    })
  })

  test("worker death broadcasts sfu unavailable to connected sockets", async () => {
    const a = createFakeWs()
    const b = createFakeWs()
    addSocket(a.ws, {
      roomId: "room-a",
      userId: "u1",
      controlAuthorized: false,
      isControlSession: false,
      sessionKind: "room",
    })
    addSocket(b.ws, {
      roomId: "room-b",
      userId: "u2",
      controlAuthorized: false,
      isControlSession: false,
      sessionKind: "room",
    })
    try {
      sfu.broadcastSfuUnavailableForTests()
      expect(a.sent).toHaveLength(1)
      expect(b.sent).toHaveLength(1)
      expect(a.sent[0]).toMatchObject({
        type: "local-media:sfu:unavailable",
        payload: { error: "sfu_worker_died" },
      })
    } finally {
      removeSocket(a.ws)
      removeSocket(b.ws)
    }
  })
})
