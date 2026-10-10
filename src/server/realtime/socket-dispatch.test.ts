import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { encodeLocalMediaChunkFrame } from "@/shared/local-media/local-media-binary"
import {
  createPending,
  pendingMap,
} from "@/server/media/local-media-relay/pending"
import {
  addSocket,
  removeSocket,
  setSocketJoinCommitted,
} from "@/server/ws/registry"
import { resetTokenBucketsForTests } from "@/server/security/rate-limit"
import {
  createFakeWs,
  createRoomState,
  InMemoryRoomStateStore,
} from "@/server/realtime/test-utils/fixtures"
import { handleSocketMessage } from "./socket-dispatch"

describe("handleSocketMessage", () => {
  beforeEach(() => {
    resetTokenBucketsForTests()
  })

  afterEach(() => {
    resetTokenBucketsForTests()
    for (const [requestId, pending] of pendingMap()) {
      clearTimeout(pending.timer)
      pendingMap().delete(requestId)
    }
  })

  test("routes binary LMC frames to resolveLocalMediaChunk", async () => {
    const { ws } = createFakeWs()
    const store = new InMemoryRoomStateStore(createRoomState())
    const requestId = "chunk-1"
    const promise = createPending(requestId, 5_000)
    const frame = encodeLocalMediaChunkFrame({
      requestId,
      ok: true,
      data: new Uint8Array([1, 2, 3]),
    })

    await handleSocketMessage(ws, store, Buffer.from(frame), true)

    const payload = await promise
    expect(payload.ok).toBe(true)
    expect(payload.requestId).toBe(requestId)
    expect(payload.data ? [...payload.data] : []).toEqual([1, 2, 3])
  })

  test("ignores non-LMC binary without JSON parse", async () => {
    const { ws, sent } = createFakeWs()
    const store = new InMemoryRoomStateStore(createRoomState())

    await handleSocketMessage(
      ws,
      store,
      Buffer.from([0xde, 0xad, 0xbe, 0xef]),
      true,
    )

    expect(sent).toHaveLength(0)
  })

  test("nacks mutations when joinCommitted is false", async () => {
    const { ws, sent } = createFakeWs()
    const store = new InMemoryRoomStateStore(createRoomState())
    addSocket(ws, {
      roomId: "room-1",
      userId: "owner",
      controlAuthorized: true,
      isControlSession: false,
      sessionKind: "room",
      joinCommitted: false,
    })

    try {
      await handleSocketMessage(
        ws,
        store,
        Buffer.from(
          JSON.stringify({
            type: "playback:seek",
            requestId: "seek-1",
            payload: { currentTimeMs: 1_000 },
          }),
        ),
        false,
      )
      expect(sent).toEqual([
        {
          type: "room:error",
          requestId: "seek-1",
          payload: { code: "not_joined", type: "playback:seek" },
        },
      ])
    } finally {
      removeSocket(ws)
    }
  })

  test("silently drops fire-and-forget when not joined", async () => {
    const { ws, sent } = createFakeWs()
    const store = new InMemoryRoomStateStore(createRoomState())
    addSocket(ws, {
      roomId: "room-1",
      userId: "owner",
      controlAuthorized: true,
      isControlSession: false,
      sessionKind: "room",
    })

    try {
      await handleSocketMessage(
        ws,
        store,
        Buffer.from(
          JSON.stringify({
            type: "seek:preview",
            requestId: "preview-1",
            payload: { currentTimeMs: 500 },
          }),
        ),
        false,
      )
      expect(sent).toHaveLength(0)
    } finally {
      removeSocket(ws)
    }
  })

  test("dispatches JSON mutations after joinCommitted", async () => {
    const { ws, sent } = createFakeWs()
    const store = new InMemoryRoomStateStore(createRoomState())
    addSocket(ws, {
      roomId: "room-1",
      userId: "owner",
      controlAuthorized: true,
      isControlSession: false,
      sessionKind: "room",
    })
    setSocketJoinCommitted(ws, true)

    try {
      await handleSocketMessage(
        ws,
        store,
        Buffer.from(
          JSON.stringify({
            type: "playback:pause",
            requestId: "pause-1",
            payload: {},
          }),
        ),
        false,
      )
      expect(
        sent.some(
          (m) =>
            (m as { type?: string; requestId?: string }).requestId ===
              "pause-1" &&
            (m as { type?: string }).type === "room:error" &&
            (m as { payload?: { code?: string } }).payload?.code ===
              "not_joined",
        ),
      ).toBe(false)
    } finally {
      removeSocket(ws)
    }
  })
})
