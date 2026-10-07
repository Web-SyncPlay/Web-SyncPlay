import { describe, expect, test } from "bun:test"
import { isRoomEmbedPath, parseRoomId } from "./room-utils"

describe("parseRoomId", () => {
  test("accepts bare ids, paths, and URLs", () => {
    expect(parseRoomId("crimson-falcon")).toBe("crimson-falcon")
    expect(parseRoomId("/room/alpha-beta")).toBe("alpha-beta")
    expect(parseRoomId("https://example.test/room/gamma%20delta")).toBe(
      "gamma delta",
    )
    expect(parseRoomId("   ")).toBeNull()
  })
})

describe("isRoomEmbedPath", () => {
  test("matches player and control embeds only", () => {
    expect(isRoomEmbedPath("/room/abc/player")).toBe(true)
    expect(isRoomEmbedPath("/room/abc/control/")).toBe(true)
    expect(isRoomEmbedPath("/room/abc")).toBe(false)
    expect(isRoomEmbedPath("/")).toBe(false)
  })
})
