import { afterEach, describe, expect, test } from "bun:test"
import {
  createTestBroadcastBus,
  setRoomBroadcastBusForTests,
} from "@/server/realtime/broadcast/room-broadcast-bus"
import { handleLocalMediaWebrtcSignal } from "@/server/realtime/handlers/local-media"
import {
  createFakeWs,
  createHandlerContext,
  createRoomState,
  envelope,
  InMemoryRoomStateStore,
} from "@/server/realtime/test-utils/fixtures"
import { addSocket, removeSocket } from "@/server/ws/registry"

describe("handleLocalMediaWebrtcSignal", () => {
  afterEach(() => {
    setRoomBroadcastBusForTests(null)
  })

  test("delivers signal to target user's local sockets via bus", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)

    const target = createFakeWs()
    addSocket(target.ws, {
      roomId: "room-1",
      userId: "guest",
      controlAuthorized: false,
      isControlSession: false,
      sessionKind: "room",
    })

    try {
      const ctx = createHandlerContext({ store, userId: "owner" })
      await handleLocalMediaWebrtcSignal(
        ctx,
        envelope("local-media:webrtc:signal", {
          localMediaId: "00000000-0000-4000-8000-0000000000aa",
          targetUserId: "guest",
          signal: { type: "offer", sdp: "v=0" },
        }),
      )

      expect(target.sent.length).toBeGreaterThan(0)
      const msg = target.sent[0] as {
        type: string
        payload: { fromUserId: string; localMediaId: string }
      }
      expect(msg.type).toBe("local-media:webrtc:signal")
      expect(msg.payload.fromUserId).toBe("owner")
      expect(msg.payload.localMediaId).toBe(
        "00000000-0000-4000-8000-0000000000aa",
      )
    } finally {
      removeSocket(target.ws)
    }
  })
})
