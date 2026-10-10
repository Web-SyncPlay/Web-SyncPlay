import { describe, expect, mock, test } from "bun:test"
import { keys } from "./keys"
import {
  deliverRoomPubSubMessage,
  deliverUserEphemeralPubSubMessage,
} from "./pubsub-handlers"

describe("deliverRoomPubSubMessage", () => {
  test("parses typed channel and fans out via publish port", () => {
    const fanOutFromPubSub = mock(() => {})
    const result = deliverRoomPubSubMessage({
      channel: keys.roomControlChannel("room-abc"),
      message: JSON.stringify({
        type: "room:control",
        payload: { paused: true },
        originNodeId: "node-a",
      }),
      kind: "control",
      suffix: ":control",
      publish: { fanOutFromPubSub },
    })
    expect(result).toBe("delivered")
    expect(fanOutFromPubSub).toHaveBeenCalledTimes(1)
    expect(fanOutFromPubSub).toHaveBeenCalledWith("room-abc", {
      type: "room:control",
      payload: { paused: true },
      originNodeId: "node-a",
    })
  })

  test("rejects mismatched channel suffix", () => {
    const fanOutFromPubSub = mock(() => {})
    const result = deliverRoomPubSubMessage({
      channel: keys.roomPresenceChannel("room-1"),
      message: JSON.stringify({ type: "presence:batch", payload: {} }),
      kind: "control",
      suffix: ":control",
      publish: { fanOutFromPubSub },
    })
    expect(result).toBe("bad_channel")
    expect(fanOutFromPubSub).not.toHaveBeenCalled()
  })

  test("rejects invalid JSON payload", () => {
    const fanOutFromPubSub = mock(() => {})
    const result = deliverRoomPubSubMessage({
      channel: keys.roomSnapshotChannel("room-1"),
      message: "{not-json",
      kind: "snapshot",
      suffix: ":snapshot",
      publish: { fanOutFromPubSub },
    })
    expect(result).toBe("bad_payload")
    expect(fanOutFromPubSub).not.toHaveBeenCalled()
  })

  test("rejects envelope type that does not belong on the channel", () => {
    const fanOutFromPubSub = mock(() => {})
    const result = deliverRoomPubSubMessage({
      channel: keys.roomControlChannel("room-1"),
      message: JSON.stringify({
        type: "session:capabilities",
        payload: { controlAuthorized: true },
      }),
      kind: "control",
      suffix: ":control",
      publish: { fanOutFromPubSub },
    })
    expect(result).toBe("bad_type")
    expect(fanOutFromPubSub).not.toHaveBeenCalled()
  })
})

describe("deliverUserEphemeralPubSubMessage", () => {
  test("parses user channel and fans out without originNodeId", () => {
    const fanOutUserEphemeral = mock(() => {})
    const result = deliverUserEphemeralPubSubMessage({
      channel: keys.roomUserEphemeralChannel("room-1", "user-2"),
      message: JSON.stringify({
        type: "local-media:webrtc:signal",
        requestId: "req-1",
        payload: { sdp: "x" },
        originNodeId: "other-node",
      }),
      localNodeId: "local-node",
      publish: { fanOutUserEphemeral },
    })
    expect(result).toBe("delivered")
    expect(fanOutUserEphemeral).toHaveBeenCalledTimes(1)
    expect(fanOutUserEphemeral).toHaveBeenCalledWith("room-1", "user-2", {
      type: "local-media:webrtc:signal",
      requestId: "req-1",
      payload: { sdp: "x" },
    })
  })

  test("skips same-node originNodeId echo", () => {
    const fanOutUserEphemeral = mock(() => {})
    const result = deliverUserEphemeralPubSubMessage({
      channel: keys.roomUserEphemeralChannel("room-1", "user-2"),
      message: JSON.stringify({
        type: "local-media:webrtc:signal",
        payload: {},
        originNodeId: "local-node",
      }),
      localNodeId: "local-node",
      publish: { fanOutUserEphemeral },
    })
    expect(result).toBe("skipped_echo")
    expect(fanOutUserEphemeral).not.toHaveBeenCalled()
  })

  test("rejects malformed user-ephemeral channel", () => {
    const fanOutUserEphemeral = mock(() => {})
    const result = deliverUserEphemeralPubSubMessage({
      channel: "room:room-1:control",
      message: JSON.stringify({ type: "x", payload: {} }),
      localNodeId: "local-node",
      publish: { fanOutUserEphemeral },
    })
    expect(result).toBe("bad_channel")
    expect(fanOutUserEphemeral).not.toHaveBeenCalled()
  })
})
