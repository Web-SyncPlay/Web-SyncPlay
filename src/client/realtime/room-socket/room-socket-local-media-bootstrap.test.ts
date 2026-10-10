import { beforeAll, describe, expect, mock, test } from "bun:test"
import type { LocalMediaRuntime } from "@/client/local-media/local-media-runtime"
import { createRoomState } from "@/shared/test-utils/room-fixtures"
import type { RoomSnapshotPayload } from "@/contracts/types"
import { createLocalMediaBootstrap } from "./room-socket-local-media-bootstrap"
import type { LocalMediaSfuSession } from "./room-socket-local-media-sfu"

const WS_OPEN = 1
const WS_CLOSED = 3

beforeAll(() => {
  if (typeof globalThis.WebSocket === "undefined") {
    class FakeWebSocket {
      static CONNECTING = 0
      static OPEN = WS_OPEN
      static CLOSING = 2
      static CLOSED = WS_CLOSED
    }
    ;(globalThis as unknown as { WebSocket: typeof FakeWebSocket }).WebSocket =
      FakeWebSocket
  }
})

function snapshotPayload(): RoomSnapshotPayload {
  return createRoomState() as RoomSnapshotPayload
}

function createHarness(readyState: number = WS_OPEN) {
  const sendSfuRequest = mock(async () => ({
    ok: true,
    producers: [] as Array<{ localMediaId?: string }>,
  }))
  const provideViaSfu = mock(() => {})
  const markSfuAvailable = mock(() => {})
  const drainPendingProvides = mock(() => [] as string[])
  const getSfuAvailable = mock(() => false)

  const sfu = {
    sendSfuRequest,
    provideViaSfu,
    markSfuAvailable,
    drainPendingProvides,
    getSfuAvailable,
  } as unknown as LocalMediaSfuSession

  const configureWebrtc = mock(async () => {})
  const configureSfu = mock(async () => {})
  const attachSwBridge = mock(() => () => {})
  const inviteWebrtcForCurrentItem = mock(() => {})

  const runtime = {
    configureWebrtc,
    configureSfu,
    attachSwBridge,
    inviteWebrtcForCurrentItem,
  } as unknown as LocalMediaRuntime

  const ws = { readyState } as WebSocket
  const sendEnvelope = mock(() => true)
  const roomStateRef = { current: snapshotPayload() }

  const bootstrap = createLocalMediaBootstrap({
    ws,
    roomId: "room-1",
    userId: "owner",
    roomStateRef,
    getDetachSwBridge: () => null,
    setDetachSwBridge: () => {},
    sendEnvelope,
    sfu,
    runtime,
  })

  return {
    bootstrap,
    sendSfuRequest,
    configureWebrtc,
    configureSfu,
    attachSwBridge,
    inviteWebrtcForCurrentItem,
    provideViaSfu,
  }
}

describe("createLocalMediaBootstrap cancellation", () => {
  test("already-aborted signal skips SFU capabilities and webrtc setup", async () => {
    const h = createHarness()
    const ac = new AbortController()
    ac.abort()

    h.bootstrap.bootstrapAfterFirstSnapshot(snapshotPayload(), ac.signal)
    await Bun.sleep(30)

    expect(h.sendSfuRequest).not.toHaveBeenCalled()
    expect(h.configureWebrtc).not.toHaveBeenCalled()
    expect(h.configureSfu).not.toHaveBeenCalled()
    expect(h.attachSwBridge).not.toHaveBeenCalled()
    expect(h.inviteWebrtcForCurrentItem).not.toHaveBeenCalled()
    expect(h.provideViaSfu).not.toHaveBeenCalled()
  })

  test("closed socket skips SFU capabilities request", async () => {
    const h = createHarness(WS_CLOSED)

    h.bootstrap.bootstrapAfterFirstSnapshot(snapshotPayload())
    await Bun.sleep(30)

    expect(h.sendSfuRequest).not.toHaveBeenCalled()
  })
})
