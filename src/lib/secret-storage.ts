"use client"

const ENCRYPTED_PREFIX = "enc:v1:"
const KEY_DB_NAME = "web-syncplay-crypto"
const KEY_STORE_NAME = "keys"
const KEY_RECORD_ID = "identity-aes-key"
/** Fallback when IndexedDB is unavailable (private mode / test mocks). */
const KEY_FALLBACK_STORAGE_KEY = "web-syncplay:identity-aes-key"

let cachedKey: CryptoKey | null = null

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function openKeyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEY_DB_NAME, 1)
    request.onerror = () => reject(request.error ?? new Error("indexedDB open failed"))
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(KEY_STORE_NAME)) {
        db.createObjectStore(KEY_STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
}

async function readKeyFromIndexedDb(): Promise<CryptoKey | null> {
  if (typeof indexedDB === "undefined") {
    return null
  }
  try {
    const db = await openKeyDatabase()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(KEY_STORE_NAME, "readonly")
      const store = tx.objectStore(KEY_STORE_NAME)
      const request = store.get(KEY_RECORD_ID)
      request.onerror = () => reject(request.error ?? new Error("indexedDB read failed"))
      request.onsuccess = () => {
        const value = request.result
        resolve(value instanceof CryptoKey ? value : null)
      }
      tx.oncomplete = () => db.close()
    })
  } catch {
    return null
  }
}

async function writeKeyToIndexedDb(key: CryptoKey): Promise<void> {
  if (typeof indexedDB === "undefined") {
    return
  }
  try {
    const db = await openKeyDatabase()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(KEY_STORE_NAME, "readwrite")
      const store = tx.objectStore(KEY_STORE_NAME)
      const request = store.put(key, KEY_RECORD_ID)
      request.onerror = () => reject(request.error ?? new Error("indexedDB write failed"))
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error ?? new Error("indexedDB transaction failed"))
    })
  } catch {
    // Fall through to localStorage key material below.
  }
}

async function readKeyFromFallbackStorage(): Promise<CryptoKey | null> {
  if (typeof window === "undefined") {
    return null
  }
  try {
    const raw = window.localStorage.getItem(KEY_FALLBACK_STORAGE_KEY)
    if (!raw) {
      return null
    }
    const jwk = JSON.parse(raw) as JsonWebKey
    return await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    )
  } catch {
    return null
  }
}

async function writeKeyToFallbackStorage(key: CryptoKey): Promise<void> {
  if (typeof window === "undefined") {
    return
  }
  try {
    const extractable = await crypto.subtle.exportKey("jwk", key)
    window.localStorage.setItem(KEY_FALLBACK_STORAGE_KEY, JSON.stringify(extractable))
  } catch {
    // Ignore quota / private-mode failures.
  }
}

async function generateAesKey(extractable: boolean): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, extractable, [
    "encrypt",
    "decrypt",
  ])
}

async function getOrCreateAesKey(): Promise<CryptoKey> {
  if (cachedKey) {
    return cachedKey
  }

  const fromIdb = await readKeyFromIndexedDb()
  if (fromIdb) {
    cachedKey = fromIdb
    return fromIdb
  }

  const fromFallback = await readKeyFromFallbackStorage()
  if (fromFallback) {
    cachedKey = fromFallback
    void writeKeyToIndexedDb(fromFallback)
    return fromFallback
  }

  // Prefer non-extractable IndexedDB keys; keep extractable for fallback persistence.
  const idbKey = await generateAesKey(false)
  await writeKeyToIndexedDb(idbKey)
  const stored = await readKeyFromIndexedDb()
  if (stored) {
    cachedKey = stored
    return stored
  }

  const fallbackKey = await generateAesKey(true)
  await writeKeyToFallbackStorage(fallbackKey)
  cachedKey = fallbackKey
  return fallbackKey
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX)
}

/** Encrypts sensitive plaintext for at-rest browser storage (CodeQL ProtectCall). */
export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await getOrCreateAesKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded,
  )
  const cipherBytes = new Uint8Array(cipherBuffer)
  const packed = new Uint8Array(iv.length + cipherBytes.length)
  packed.set(iv, 0)
  packed.set(cipherBytes, iv.length)
  return `${ENCRYPTED_PREFIX}${bytesToBase64(packed)}`
}

/**
 * Decrypts a value previously produced by {@link encryptSecret}.
 * Legacy cleartext values are returned as-is so callers can migrate them.
 */
export async function decryptSecret(stored: string): Promise<string | null> {
  if (!isEncryptedSecret(stored)) {
    return stored
  }

  try {
    const key = await getOrCreateAesKey()
    const packed = base64ToBytes(stored.slice(ENCRYPTED_PREFIX.length))
    if (packed.length <= 12) {
      return null
    }
    const iv = packed.slice(0, 12)
    const cipherBytes = packed.slice(12)
    const plainBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      cipherBytes,
    )
    return new TextDecoder().decode(plainBuffer)
  } catch {
    return null
  }
}

/** Test helper — clears the in-memory key cache between cases. */
export function resetSecretStorageCacheForTests(): void {
  cachedKey = null
}
