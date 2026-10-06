import { expect, test } from "bun:test"
import {
  consumeSessionIdentityFromHash,
  getOrCreateSessionIdentity,
  getPersistedUsername,
  persistUsername,
  stripIdentityHashFromUrl,
} from "./session-identity"
import {
  isEncryptedSecret,
  resetSecretStorageCacheForTests,
} from "./secret-storage"

type MockStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
  clear: () => void
}

function createMockWindow(hash: string) {
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

  ;(globalThis as { window?: unknown }).window = {
    localStorage,
    location: {
      hash,
      pathname: "/room/abc/player",
      search: "?embed=1",
    },
    history: {
      state: {},
      replaceState: (_state: unknown, _title: string, url?: string | URL | null) => {
        replacedUrl = typeof url === "string" ? url : null
      },
    },
  }

  return {
    storage,
    getReplacedUrl: () => replacedUrl,
  }
}

function cleanupWindow() {
  delete (globalThis as { window?: unknown }).window
  resetSecretStorageCacheForTests()
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
