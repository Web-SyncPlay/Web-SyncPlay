import { describe, expect, test } from "bun:test"
import {
  isPlayerEmbedPath,
  isRoomEmbedPath,
  parseRoomId,
} from "./room-utils"

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
  test("matches player, control, and site embed routes", () => {
    expect(isRoomEmbedPath("/room/abc/player")).toBe(true)
    expect(isRoomEmbedPath("/room/abc/control/")).toBe(true)
    expect(isRoomEmbedPath("/room/abc/embed")).toBe(true)
    expect(isRoomEmbedPath("/room/abc")).toBe(false)
    expect(isRoomEmbedPath("/")).toBe(false)
  })
})

describe("isPlayerEmbedPath", () => {
  test("matches chrome-less player and site embed routes", () => {
    expect(isPlayerEmbedPath("/room/abc/player")).toBe(true)
    expect(isPlayerEmbedPath("/room/abc/player/")).toBe(true)
    expect(isPlayerEmbedPath("/room/abc/embed")).toBe(true)
    expect(isPlayerEmbedPath("/room/abc/embed/")).toBe(true)
    expect(isPlayerEmbedPath("/room/abc/control")).toBe(false)
    expect(isPlayerEmbedPath("/room/abc")).toBe(false)
  })

  test("keeps encoded room ids as one segment", () => {
    expect(isPlayerEmbedPath("/room/hello%20world/embed")).toBe(true)
    expect(isPlayerEmbedPath("/room/a%2Fb/player")).toBe(true)
    expect(isPlayerEmbedPath("/room/abc/embed/extra")).toBe(false)
  })
})
