import { describe, expect, test } from "bun:test"
import { createFakeWs } from "@/server/realtime/test-utils/fixtures"
import {
  sendMutationNack,
  shouldNackAtDispatch,
  shouldNackMutation,
} from "./mutation-nack"

describe("mutation nacks", () => {
  test("excludes seek-preview and presence fire-and-forget from handler nacks", () => {
    expect(shouldNackMutation("seek:preview")).toBe(false)
    expect(shouldNackMutation("participant:update")).toBe(false)
    expect(shouldNackMutation("local-media:webrtc:signal")).toBe(false)
    expect(shouldNackMutation("local-media:chunk")).toBe(false)
    expect(shouldNackMutation("playback:seek")).toBe(true)
    expect(shouldNackMutation("playlist:add:url")).toBe(true)
  })

  test("dispatch nacks cover SFU rate/join gates but not presence", () => {
    expect(shouldNackAtDispatch("local-media:sfu:create-transport")).toBe(true)
    expect(shouldNackAtDispatch("playback:seek")).toBe(true)
    expect(shouldNackAtDispatch("seek:preview")).toBe(false)
    expect(shouldNackAtDispatch("participant:update")).toBe(false)
  })

  test("sendMutationNack requires requestId and emits room:error", () => {
    const { ws, sent } = createFakeWs()
    sendMutationNack(
      ws,
      { type: "playback:seek", requestId: "req-1" },
      "unauthorized",
    )
    expect(sent).toEqual([
      {
        type: "room:error",
        requestId: "req-1",
        payload: { code: "unauthorized", type: "playback:seek" },
      },
    ])

    sendMutationNack(ws, { type: "playback:seek" }, "unauthorized")
    expect(sent).toHaveLength(1)
  })
})
