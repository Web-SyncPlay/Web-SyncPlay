import { describe, expect, test } from "bun:test"
import { createLocalMediaEnvelopeHandler } from "@/client/realtime/room-socket/room-socket-local-media-handlers"
import { createSendEnvelope } from "@/client/realtime/room-socket/room-socket-local-media-send"
import type { LocalMediaSfuSession } from "@/client/realtime/room-socket/room-socket-local-media-sfu"
import type { WsEnvelope } from "@/contracts/types"

function envelope(
  type: string,
  payload: unknown = {},
): WsEnvelope<string, unknown> {
  return { type, payload, requestId: "req-1" }
}

describe("createLocalMediaEnvelopeHandler", () => {
  test("routes known local-media envelopes and ignores others", () => {
    const calls = {
      read: 0,
      signal: 0,
      reannounce: 0,
      sfuResult: 0,
      sfuProducer: 0,
      sfuUnavailable: 0,
    }

    const sfu = {
      handleSfuResult: () => {
        calls.sfuResult += 1
      },
      handleSfuProducer: () => {
        calls.sfuProducer += 1
      },
      handleSfuUnavailable: () => {
        calls.sfuUnavailable += 1
      },
    } as Pick<
      LocalMediaSfuSession,
      "handleSfuResult" | "handleSfuProducer" | "handleSfuUnavailable"
    >

    const handle = createLocalMediaEnvelopeHandler({
      sfu: sfu as LocalMediaSfuSession,
      handleLocalMediaRead: () => {
        calls.read += 1
      },
      handleWebrtcSignal: () => {
        calls.signal += 1
      },
      handleReannounce: () => {
        calls.reannounce += 1
      },
    })

    expect(handle(envelope("local-media:read"))).toBe(true)
    expect(handle(envelope("local-media:sfu:result"))).toBe(true)
    expect(handle(envelope("local-media:sfu:producer"))).toBe(true)
    expect(handle(envelope("local-media:sfu:unavailable"))).toBe(true)
    expect(handle(envelope("local-media:webrtc:signal"))).toBe(true)
    expect(handle(envelope("local-media:reannounce"))).toBe(true)
    expect(handle(envelope("room:state"))).toBe(false)
    expect(handle(envelope("local-media:chunk"))).toBe(false)

    expect(calls).toEqual({
      read: 1,
      signal: 1,
      reannounce: 1,
      sfuResult: 1,
      sfuProducer: 1,
      sfuUnavailable: 1,
    })
  })
})

describe("createSendEnvelope", () => {
  test("sends JSON envelopes only while the socket is open", () => {
    const sent: string[] = []
    const OPEN = 1
    const CLOSED = 3
    const ws = {
      readyState: OPEN,
      send(data: string) {
        sent.push(data)
      },
    } as Pick<WebSocket, "readyState" | "send">

    const send = createSendEnvelope(ws as WebSocket)
    expect(send("local-media:reannounce", { roomId: "r1" })).toBe(true)
    expect(sent).toHaveLength(1)

    const parsed = JSON.parse(sent[0]!) as {
      type: string
      payload: { roomId: string }
      requestId: string
    }
    expect(parsed.type).toBe("local-media:reannounce")
    expect(parsed.payload).toEqual({ roomId: "r1" })
    expect(typeof parsed.requestId).toBe("string")
    expect(parsed.requestId.length).toBeGreaterThan(0)

    ;(ws as { readyState: number }).readyState = CLOSED
    expect(send("local-media:reannounce", {})).toBe(false)
    expect(sent).toHaveLength(1)
  })
})
