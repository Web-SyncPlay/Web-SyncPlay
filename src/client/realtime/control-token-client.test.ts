import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  CONTROL_TOKEN_REMINT_SKEW_MS,
  createControlTokenRefreshScheduler,
  createControlTokenReminter,
  mintRoomControlToken,
  mintRoomControlTokenWithRetry,
  msUntilControlTokenRemint,
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
    expect(
      JSON.parse(stored["web-syncplay:control-token:room-1"]!),
    ).toEqual({
      token: "from-hash",
    })
  })

  test("loads session storage for control sessions without hash", () => {
    ;(globalThis as { window?: unknown }).window = {
      sessionStorage: {
        getItem: () => JSON.stringify({ token: "stored-tok", expiresAt: 99 }),
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

describe("msUntilControlTokenRemint", () => {
  test("returns 0 when already expired", () => {
    expect(msUntilControlTokenRemint(1_000, 2_000)).toBe(0)
  })

  test("schedules skew before expiry", () => {
    const now = 1_000_000
    const expiresAt = now + CONTROL_TOKEN_REMINT_SKEW_MS * 10
    expect(msUntilControlTokenRemint(expiresAt, now)).toBe(
      expiresAt - now - CONTROL_TOKEN_REMINT_SKEW_MS,
    )
  })

  test("caps skew to 10% of remaining lifetime", () => {
    const now = 0
    const expiresAt = 10_000
    // 10% of 10s = 1s < 60s skew
    expect(msUntilControlTokenRemint(expiresAt, now)).toBe(9_000)
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
      Promise.resolve(
        Response.json({ token: "mint-1", expiresAt: Date.now() + 60_000 }),
      ),
    )
    ;(globalThis as { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch
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
    expect(JSON.parse(stored["web-syncplay:control-token:r1"]!).token).toBe(
      "mint-1",
    )
    expect(
      typeof JSON.parse(stored["web-syncplay:control-token:r1"]!).expiresAt,
    ).toBe("number")

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
    delete (globalThis as { window?: unknown }).window
  })

  test("returns null for empty identity fields", async () => {
    expect(
      await mintRoomControlToken({ roomId: "", userId: "u", userSecret: "s" }),
    ).toBeNull()
  })

  test("persists token and expiresAt on success", async () => {
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
    ;(globalThis as { fetch?: typeof fetch }).fetch = mock(() =>
      Promise.resolve(
        Response.json({ token: "t1", expiresAt: 42 }),
      ),
    ) as unknown as typeof fetch

    const minted = await mintRoomControlToken({
      roomId: "r1",
      userId: "u1",
      userSecret: "s1",
    })
    expect(minted).toEqual({ token: "t1", expiresAt: 42 })
    expect(JSON.parse(stored["web-syncplay:control-token:r1"]!)).toEqual({
      token: "t1",
      expiresAt: 42,
    })
  })
})

describe("mintRoomControlTokenWithRetry", () => {
  afterEach(() => {
    mock.restore()
    delete (globalThis as { fetch?: typeof fetch }).fetch
    delete (globalThis as { window?: unknown }).window
  })

  test("retries until success", async () => {
    let calls = 0
    ;(globalThis as { window?: unknown }).window = {
      sessionStorage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    }
    ;(globalThis as { fetch?: typeof fetch }).fetch = mock(() => {
      calls += 1
      if (calls < 2) {
        return Promise.resolve(new Response(null, { status: 503 }))
      }
      return Promise.resolve(
        Response.json({ token: "ok", expiresAt: 99 }),
      )
    }) as unknown as typeof fetch

    const sleeps: number[] = []
    const minted = await mintRoomControlTokenWithRetry(
      { roomId: "r1", userId: "u1", userSecret: "s1" },
      {
        maxAttempts: 3,
        baseDelayMs: 10,
        sleep: async (ms) => {
          sleeps.push(ms)
        },
      },
    )
    expect(minted).toEqual({ token: "ok", expiresAt: 99 })
    expect(calls).toBe(2)
    expect(sleeps).toEqual([10])
  })
})

describe("createControlTokenRefreshScheduler", () => {
  test("fires remint before expiry and notifies onMinted", async () => {
    const timers: Array<{ id: number; fn: () => void; ms: number }> = []
    let nextId = 1
    const mint = mock(() =>
      Promise.resolve({ token: "fresh", expiresAt: 2_000_000 }),
    )
    const onMinted = mock(() => undefined)

    const scheduler = createControlTokenRefreshScheduler({
      mint: mint as unknown as typeof mintRoomControlToken,
      onMinted,
      now: () => 1_000_000,
      setTimer: (fn, ms) => {
        const id = nextId++
        timers.push({ id, fn, ms })
        return id
      },
      clearTimer: (id) => {
        const idx = timers.findIndex((t) => t.id === id)
        if (idx >= 0) timers.splice(idx, 1)
      },
    })

    // Remaining lifetime >> skew so delay is remaining - CONTROL_TOKEN_REMINT_SKEW_MS.
    const expiresAt = 1_000_000 + CONTROL_TOKEN_REMINT_SKEW_MS * 10
    scheduler.arm(
      { roomId: "r1", userId: "u1", userSecret: "s1" },
      expiresAt,
    )
    expect(timers).toHaveLength(1)
    expect(timers[0]!.ms).toBe(CONTROL_TOKEN_REMINT_SKEW_MS * 9)

    timers[0]!.fn()
    await Promise.resolve()
    await Promise.resolve()

    expect(mint).toHaveBeenCalledTimes(1)
    expect(onMinted).toHaveBeenCalledWith({
      token: "fresh",
      expiresAt: 2_000_000,
    })

    scheduler.disarm()
  })
})
