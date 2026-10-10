import { expect, test } from "bun:test"
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
  resetSecretStorageCacheForTests,
} from "./secret-storage"

function installLocalStorage() {
  const storage = new Map<string, string>()
  ;(globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value)
      },
      removeItem: (key: string) => {
        storage.delete(key)
      },
      clear: () => {
        storage.clear()
      },
    },
  }
  return storage
}

test("encryptSecret round-trips and does not store cleartext", async () => {
  installLocalStorage()
  resetSecretStorageCacheForTests()

  const encrypted = await encryptSecret("room-owner-secret")
  expect(isEncryptedSecret(encrypted)).toBe(true)
  expect(encrypted).not.toContain("room-owner-secret")
  expect(await decryptSecret(encrypted)).toBe("room-owner-secret")

  resetSecretStorageCacheForTests()
  delete (globalThis as { window?: unknown }).window
})
