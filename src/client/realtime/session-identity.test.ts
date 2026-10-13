import { expect, test } from "bun:test"
import {
  isEncryptedSecret,
  resetSecretStorageCacheForTests,
} from "./secret-storage"
import {
  clearPersistedControlToken,
  consumeSessionIdentityFromHash,
  getOrCreateSessionIdentity,
  getPersistedUsername,
  loadPersistedControlToken,
  loadPersistedControlTokenRecord,
  persistControlToken,
  persistUsername,
  resetSessionIdentityBootstrapForTests,
  stripIdentityHashFromUrl,
} from "./session-identity"

type MockStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
  clear: () => void
}

function createMockWindow(hash: string) {
  resetSessionIdentityBootstrapForTests()
  const storage = new Map<string, string>()
  let replacedUrl: string | null = null
  const localStorage: MockStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => {
      storage.set(key, value)
    },
    removeItem: (key) => {
      storage.delete(key)
    },
    clear: () => {
      storage.clear()
    },
  }

  const sessionMap = new Map<string, string>()
  const sessionStorage: MockStorage = {
    getItem: (key) => sessionMap.get(key) ?? null,
    setItem: (key, value) => {
      sessionMap.set(key, value)
    },
    removeItem: (key) => {
      sessionMap.delete(key)
    },
    clear: () => {
      sessionMap.clear()
    },
  }

  ;(globalThis as { window?: unknown }).window = {
    localStorage,
    sessionStorage,
    location: {
      hash,
      pathname: "/room/abc/player",
      search: "?embed=1",
    },
    history: {
      state: {},
      replaceState: (
        _state: unknown,
        _title: string,
        url?: string | URL | null,
      ) => {
        replacedUrl = typeof url === "string" ? url : null
      },
    },
  }

  return {
    storage,
    sessionStorage: sessionMap,
    getReplacedUrl: () => replacedUrl,
  }
}

function cleanupWindow() {
  delete (globalThis as { window?: unknown }).window
  resetSecretStorageCacheForTests()
  resetSessionIdentityBootstrapForTests()
}

test("consumeSessionIdentityFromHash stores encrypted identity and strips hash", async () => {
  const mock = createMockWindow("#uid=user-1&secret=secret-1")

  const consumed = await consumeSessionIdentityFromHash()

  expect(consumed).toEqual({ userId: "user-1", userSecret: "secret-1" })
  expect(mock.storage.get("web-syncplay:user-id")).toBe("user-1")
  const storedSecret = mock.storage.get("web-syncplay:user-secret")
  expect(storedSecret).toBeTruthy()
  expect(isEncryptedSecret(storedSecret!)).toBe(true)
  expect(storedSecret).not.toContain("secret-1")
  expect(mock.getReplacedUrl()).toBe("/room/abc/player?embed=1")
  cleanupWindow()
})

test("concurrent consumeSessionIdentityFromHash shares one consume after hash is cleared mid-flight (Strict Mode)", async () => {
  const mock = createMockWindow("#uid=user-1&secret=secret-1")
  const win = (
    globalThis as unknown as {
      window: { location: { hash: string } }
    }
  ).window

  // Mount A: sync-writes userId, then awaits persistEncryptedUserSecret.
  const mountA = consumeSessionIdentityFromHash()
  // Strip effect clears the URL hash before mount B runs.
  win.location.hash = ""
  // Mount B: sees an empty hash but must reuse A's consume.
  const mountB = consumeSessionIdentityFromHash()

  const [a, b] = await Promise.all([mountA, mountB])
  expect(a).toEqual({ userId: "user-1", userSecret: "secret-1" })
  expect(b).toEqual(a)

  // getOrCreate after consume must keep the hash secret, not mint a new one.
  const session = await getOrCreateSessionIdentity()
  expect(session).toEqual({ userId: "user-1", userSecret: "secret-1" })
  expect(mock.storage.get("web-syncplay:user-id")).toBe("user-1")

  // Late remount after consume completed still gets the cached identity.
  const late = await consumeSessionIdentityFromHash()
  expect(late).toEqual(a)
  cleanupWindow()
})

test("getOrCreateSessionIdentity migrates legacy cleartext secrets", async () => {
  const mock = createMockWindow("")
  mock.storage.set("web-syncplay:user-id", "user-legacy")
  mock.storage.set("web-syncplay:user-secret", "legacy-secret-value")

  const identity = await getOrCreateSessionIdentity()

  expect(identity).toEqual({
    userId: "user-legacy",
    userSecret: "legacy-secret-value",
  })
  const storedSecret = mock.storage.get("web-syncplay:user-secret")
  expect(storedSecret).toBeTruthy()
  expect(isEncryptedSecret(storedSecret!)).toBe(true)
  expect(storedSecret).not.toContain("legacy-secret-value")
  cleanupWindow()
})

test("consumeSessionIdentityFromHash strips malformed identity hash without storing credentials", async () => {
  const mock = createMockWindow("#uid&secret")

  const consumed = await consumeSessionIdentityFromHash()

  expect(consumed).toEqual({})
  expect(mock.storage.has("web-syncplay:user-id")).toBe(false)
  expect(mock.storage.has("web-syncplay:user-secret")).toBe(false)
  expect(mock.getReplacedUrl()).toBe("/room/abc/player?embed=1")
  cleanupWindow()
})

test("consumeSessionIdentityFromHash strips partial identity hash without storing credentials", async () => {
  const mock = createMockWindow("#uid=user-1")

  const consumed = await consumeSessionIdentityFromHash()

  expect(consumed).toEqual({})
  expect(mock.storage.has("web-syncplay:user-id")).toBe(false)
  expect(mock.storage.has("web-syncplay:user-secret")).toBe(false)
  expect(mock.getReplacedUrl()).toBe("/room/abc/player?embed=1")
  cleanupWindow()
})

test("persistUsername trims and retrieves username", () => {
  const mock = createMockWindow("")

  persistUsername("  Alice  ")

  expect(mock.storage.get("web-syncplay:username")).toBe("Alice")
  expect(getPersistedUsername()).toBe("Alice")
  cleanupWindow()
})

test("stripIdentityHashFromUrl removes identity-like malformed hash", () => {
  const mock = createMockWindow("#uid&secret")

  const stripped = stripIdentityHashFromUrl()

  expect(stripped).toBe(true)
  expect(mock.getReplacedUrl()).toBe("/room/abc/player?embed=1")
  cleanupWindow()
})

test("persistControlToken round-trips via sessionStorage", () => {
  createMockWindow("")

  persistControlToken("room-1", "tok-abc")
  expect(loadPersistedControlToken("room-1")).toBe("tok-abc")
  expect(loadPersistedControlTokenRecord("room-1")).toEqual({
    token: "tok-abc",
  })
  clearPersistedControlToken("room-1")
  expect(loadPersistedControlToken("room-1")).toBeUndefined()
  cleanupWindow()
})

test("persistControlToken stores expiresAt when provided", () => {
  createMockWindow("")

  persistControlToken("room-1", "tok-abc", 1_700_000_000_000)
  expect(loadPersistedControlTokenRecord("room-1")).toEqual({
    token: "tok-abc",
    expiresAt: 1_700_000_000_000,
  })
  cleanupWindow()
})

test("loadPersistedControlTokenRecord accepts legacy plain token strings", () => {
  const mock = createMockWindow("")
  mock.sessionStorage.set(
    "web-syncplay:control-token:room-1",
    "legacy-plain-tok",
  )

  expect(loadPersistedControlTokenRecord("room-1")).toEqual({
    token: "legacy-plain-tok",
  })
  expect(loadPersistedControlToken("room-1")).toBe("legacy-plain-tok")
  cleanupWindow()
})
