import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  createControlTokenReminter,
  mintRoomControlToken,
  resolveBootstrapControlToken,
  shouldRemintControlToken,
} from "./control-token-client"

describe("resolveBootstrapControlToken", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  test("prefers hash token and persists for the room", () => {
    const stored: Record<string, string> = {}
    ;(globalThis as { window?: unknown }).window = {
      sessionStorage: {
        getItem: (key: string) => stored[key] ?? null,
        setItem: (key: string, value: string) => {
          stored[key] = value
        },
        removeItem: () => undefined,
      },
    }

    const token = resolveBootstrapControlToken({
      sessionKind: "control",
      roomId: "room-1",
      hashControlToken: "from-hash",
    })
    expect(token).toBe("from-hash")
    expect(stored["web-syncplay:control-token:room-1"]).toBe("from-hash")
  })

  test("loads session storage for control sessions without hash", () => {
    ;(globalThis as { window?: unknown }).window = {
      sessionStorage: {
        getItem: () => "stored-tok",
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    }

    expect(
      resolveBootstrapControlToken({
        sessionKind: "control",
        roomId: "room-1",
      }),
    ).toBe("stored-tok")
  })
})

describe("shouldRemintControlToken", () => {
  test("remint only for unauthorized control sessions with mutator role", () => {
    expect(
      shouldRemintControlToken({
        sessionKind: "room",
        controlAuthorized: false,
        role: "owner",
        remintAlreadyAttempted: false,
      }),
    ).toBe(false)

    expect(
      shouldRemintControlToken({
        sessionKind: "control",
        controlAuthorized: true,
        role: "owner",
        remintAlreadyAttempted: false,
      }),
    ).toBe(false)

    expect(
      shouldRemintControlToken({
        sessionKind: "control",
        controlAuthorized: false,
        role: "guest",
        remintAlreadyAttempted: false,
      }),
    ).toBe(false)

    expect(
      shouldRemintControlToken({
        sessionKind: "control",
        controlAuthorized: false,
        role: "owner",
        remintAlreadyAttempted: true,
      }),
    ).toBe(false)

    expect(
      shouldRemintControlToken({
        sessionKind: "control",
        controlAuthorized: false,
        role: "moderator",
        remintAlreadyAttempted: false,
      }),
    ).toBe(true)
  })
})

describe("createControlTokenReminter", () => {
  afterEach(() => {
    mock.restore()
    delete (globalThis as { fetch?: typeof fetch }).fetch
    delete (globalThis as { window?: unknown }).window
  })

  test("mints at most once until reset", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(Response.json({ token: "mint-1" })),
    )
    ;(globalThis as { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch
    ;(globalThis as { window?: unknown }).window = {
      sessionStorage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    }

    const reminter = createControlTokenReminter()
    const input = {
      roomId: "r1",
      userId: "u1",
      userSecret: "s1",
      sessionKind: "control" as const,
      controlAuthorized: false,
      role: "owner" as const,
    }

    expect(await reminter.tryRemint(input)).toBe("mint-1")
    expect(await reminter.tryRemint(input)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    reminter.reset()
    expect(await reminter.tryRemint(input)).toBe("mint-1")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test("clears attempted flag when mint fails", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(new Response(null, { status: 403 })),
    )
    ;(globalThis as { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch

    const reminter = createControlTokenReminter()
    const input = {
      roomId: "r1",
      userId: "u1",
      userSecret: "s1",
      sessionKind: "control" as const,
      controlAuthorized: false,
      role: "owner" as const,
    }

    expect(await reminter.tryRemint(input)).toBeNull()
    expect(await reminter.tryRemint(input)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe("mintRoomControlToken", () => {
  afterEach(() => {
    mock.restore()
    delete (globalThis as { fetch?: typeof fetch }).fetch
  })

  test("returns null for empty identity fields", async () => {
    expect(
      await mintRoomControlToken({ roomId: "", userId: "u", userSecret: "s" }),
    ).toBeNull()
  })
})
