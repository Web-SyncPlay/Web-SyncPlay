import { describe, expect, test } from "bun:test"
import { pickPlayerEmbedUrl, pickRoomPopupUrl } from "./use-room-session"

describe("pickPlayerEmbedUrl", () => {
  test("returns empty until identity is ready", () => {
    expect(
      pickPlayerEmbedUrl({ roomId: "r1", userId: "", userSecret: "s" }),
    ).toBe("")
    expect(
      pickPlayerEmbedUrl({ roomId: "r1", userId: "u", userSecret: "" }),
    ).toBe("")
  })

  test("builds a player URL with identity hash and no control token", () => {
    const url = pickPlayerEmbedUrl({
      roomId: "r1",
      userId: "uid-1",
      userSecret: "secret-1",
    })
    expect(url.startsWith("/room/r1/player#")).toBe(true)
    expect(url).toContain("uid=uid-1")
    expect(url).toContain("secret=secret-1")
    expect(url).not.toContain("ct=")
  })
})

describe("pickRoomPopupUrl", () => {
  test("returns empty until identity is ready", () => {
    expect(
      pickRoomPopupUrl({ roomId: "r1", userId: "", userSecret: "s" }),
    ).toBe("")
    expect(
      pickRoomPopupUrl({ roomId: "r1", userId: "u", userSecret: "" }),
    ).toBe("")
  })

  test("builds a room URL with identity hash for in-app handover", () => {
    const url = pickRoomPopupUrl({
      roomId: "r1",
      userId: "uid-1",
      userSecret: "secret-1",
    })
    expect(url.startsWith("/room/r1#")).toBe(true)
    expect(url).toContain("uid=uid-1")
    expect(url).toContain("secret=secret-1")
    expect(url).not.toContain("/player")
    expect(url).not.toContain("/control")
  })
})
