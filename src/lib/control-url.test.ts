import { afterEach, describe, expect, test } from "bun:test"
import {
  getControlEmbedUrl,
  getPlayerEmbedUrl,
  getRoomUrl,
} from "./control-url"

describe("control-url", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  test("getRoomUrl is relative without window", () => {
    expect(getRoomUrl("abc")).toBe("/room/abc")
  })

  test("embed URLs attach identity hash without window", () => {
    const control = getControlEmbedUrl("abc", "uid-1", "secret-1", "tok")
    expect(control.startsWith("/room/abc/control#")).toBe(true)
    expect(control).toContain("uid=uid-1")
    expect(control).toContain("secret=secret-1")
    expect(control).toContain("ct=tok")

    const player = getPlayerEmbedUrl("abc", "uid-1", "secret-1")
    expect(player.startsWith("/room/abc/player#")).toBe(true)
    expect(player).not.toContain("ct=")
  })

  test("getRoomUrl is absolute with window", () => {
    ;(globalThis as { window?: unknown }).window = {
      location: { origin: "https://example.test" },
    }
    expect(getRoomUrl("abc")).toBe("https://example.test/room/abc")
  })
})
