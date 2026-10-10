import { describe, expect, test } from "bun:test"
import { MAX_SOCKET_MESSAGE_QUEUE_DEPTH } from "@/server/realtime/realtime-server"

describe("realtime-server backpressure", () => {
  test("exposes a finite per-socket message queue depth", () => {
    expect(MAX_SOCKET_MESSAGE_QUEUE_DEPTH).toBeGreaterThan(0)
    expect(Number.isFinite(MAX_SOCKET_MESSAGE_QUEUE_DEPTH)).toBe(true)
  })
})
