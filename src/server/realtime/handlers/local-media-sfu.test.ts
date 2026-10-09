import { afterAll, describe, expect, mock, test } from "bun:test"
import {
  createFakeWs,
  createHandlerContext,
  createRoomState,
  envelope,
  InMemoryRoomStateStore,
} from "@/server/realtime/test-utils/fixtures"
import { addSocket, removeSocket } from "@/server/ws/registry"

const closedProducerIds: string[] = []
const clearedMediaIds: string[] = []
let workerDiedListener: (() => void) | null = null
let produceShouldListThrow = false

const sfuMocks = {
  ensureMediasoupRuntime: async () => ({ ok: true }),
  mediasoupCreateRouter: async () => ({
    rtpCapabilities: { codecs: [] },
  }),
  listLocalMediaSfuProducers: () => [],
  listLocalMediaSfuRequestProducers: () => {
    if (produceShouldListThrow) {
      throw new Error("list_failed")
    }
    return []
  },
  getLocalMediaSfuProducer: () => null,
  getMediasoupDataProducerAppData: () => null,
  getMediasoupTransportAppData: (transportId: string) =>
    transportId === "transport-1"
      ? { roomKey: "room-1", direction: "send" as const }
      : null,
  mediasoupCloseTransport: () => {},
  mediasoupConnectTransport: async () => ({ ok: true }),
  mediasoupConsumeData: async () => ({}),
  mediasoupCreateTransport: async () => ({
    id: "transport-1",
    iceParameters: {},
    iceCandidates: [],
    dtlsParameters: {},
    sctpParameters: {},
  }),
  mediasoupProduceData: async () => ({ id: "producer-failed" }),
  onMediasoupTransportClosed: (_id: string, _cb: () => void) => {},
  onMediasoupWorkerDied: (cb: () => void) => {
    workerDiedListener = cb
    return () => {
      workerDiedListener = null
    }
  },
  clearLocalMediaSfuProducer: (localMediaId: string) => {
    clearedMediaIds.push(localMediaId)
  },
  closeLocalMediaSfuDataProducer: (producerId: string) => {
    closedProducerIds.push(producerId)
  },
}

mock.module("@/server/media/mediasoup-runtime", () => sfuMocks)
mock.module("@/server/media/local-media-store", () => ({
  getLocalMediaEntry: async (localMediaId: string) => ({
    localMediaId,
    roomId: "room-1",
    ownerUserId: "owner",
  }),
}))

const sfu = await import("@/server/realtime/handlers/local-media-sfu")

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
    closedProducerIds.length = 0
    clearedMediaIds.length = 0
    produceShouldListThrow = true
    const mediaId = "11111111-1111-4111-8111-111111111111"
    try {
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
      expect(clearedMediaIds).toEqual([])
      expect(sent.at(-1)).toMatchObject({
        type: "local-media:sfu:result",
        payload: { ok: false, error: "list_failed" },
      })
    } finally {
      produceShouldListThrow = false
    }
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
      // Prefer the mock-captured listener when mock.module applied before import;
      // otherwise call the handler export (full-suite preload path).
      if (workerDiedListener) {
        workerDiedListener()
      } else {
        sfu.broadcastSfuUnavailableForTests()
      }
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
