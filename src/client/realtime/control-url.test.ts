import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  getControlEmbedUrl,
  getPlayerEmbedUrl,
  getRoomPopupUrl,
  getRoomUrl,
  mintControlEmbedUrl,
  requestControlToken,
} from "./control-url"

describe("control-url", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
    mock.restore()
  })

  test("getRoomUrl is relative without window", () => {
    expect(getRoomUrl("abc")).toBe("/room/abc")
  })

  test("getRoomUrl percent-encodes special characters", () => {
    expect(getRoomUrl("my-room^^")).toBe("/room/my-room%5E%5E")
    expect(getRoomUrl("hello world")).toBe("/room/hello%20world")
  })

  test("empty identity credentials never produce a handover hash", () => {
    expect(getPlayerEmbedUrl("abc", "", "secret-1")).toBe("")
    expect(getPlayerEmbedUrl("abc", "uid-1", "")).toBe("")
    expect(getControlEmbedUrl("abc", "", "secret-1")).toBe("")
    expect(getControlEmbedUrl("abc", "uid-1", "", "tok")).toBe("")
    expect(getRoomPopupUrl("abc", "", "secret-1")).toBe("")
    expect(getRoomPopupUrl("abc", "uid-1", "")).toBe("")
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

    const roomPopup = getRoomPopupUrl("abc", "uid-1", "secret-1")
    expect(roomPopup.startsWith("/room/abc#")).toBe(true)
    expect(roomPopup).toContain("uid=uid-1")
    expect(roomPopup).toContain("secret=secret-1")
  })

  test("getRoomUrl is absolute with window", () => {
    ;(globalThis as { window?: unknown }).window = {
      location: { origin: "https://example.test" },
      sessionStorage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    }
    expect(getRoomUrl("abc")).toBe("https://example.test/room/abc")
  })

  test("requestControlToken returns null when mint fails", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(new Response(null, { status: 403 })),
    )
    ;(globalThis as { fetch?: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch

    expect(
      await requestControlToken({
        roomId: "r1",
        userId: "u1",
        userSecret: "s1",
      }),
    ).toBeNull()
    expect(
      await mintControlEmbedUrl({
        roomId: "r1",
        userId: "u1",
        userSecret: "s1",
      }),
    ).toBeNull()
  })

  test("mintControlEmbedUrl returns hashed URL with token on success", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(Response.json({ token: "minted-tok", expiresAt: 1 })),
    )
    ;(globalThis as { fetch?: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch
    ;(globalThis as { window?: unknown }).window = {
      location: { origin: "https://example.test" },
      sessionStorage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    }

    const url = await mintControlEmbedUrl({
      roomId: "r1",
      userId: "u1",
      userSecret: "s1",
    })
    expect(url).toContain("/room/r1/control#")
    expect(url).toContain("ct=minted-tok")
  })
})
