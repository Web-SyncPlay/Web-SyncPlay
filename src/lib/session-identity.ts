"use client"

import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from "@/lib/secret-storage"

const USER_ID_KEY = "web-syncplay:user-id"
const USER_SECRET_KEY = "web-syncplay:user-secret"
const USERNAME_KEY = "web-syncplay:username"

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes)
  crypto.getRandomValues(buffer)
  return Array.from(buffer, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("")
}

function isValidIdentityValue(value: string | null): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function looksLikeIdentityBootstrapHash(rawHash: string): boolean {
  const params = new URLSearchParams(rawHash)
  if (params.has("uid") || params.has("secret") || params.has("ct")) {
    return true
  }
  return (
    /(^|[&;])uid(?:[=&;]|$)/i.test(rawHash) ||
    /(^|[&;])secret(?:[=&;]|$)/i.test(rawHash) ||
    /(^|[&;])ct(?:[=&;]|$)/i.test(rawHash)
  )
}

function clearUrlHash(): void {
  const cleanUrl = `${window.location.pathname}${window.location.search}`
  window.history.replaceState(window.history.state, "", cleanUrl)
}

async function persistEncryptedUserSecret(userSecret: string): Promise<void> {
  const encrypted = await encryptSecret(userSecret)
  window.localStorage.setItem(USER_SECRET_KEY, encrypted)
}

async function readUserSecretFromStorage(): Promise<string | null> {
  const existingSecret = window.localStorage.getItem(USER_SECRET_KEY)
  if (!isValidIdentityValue(existingSecret)) {
    return null
  }

  const decrypted = await decryptSecret(existingSecret)
  if (!isValidIdentityValue(decrypted)) {
    return null
  }

  // Migrate legacy cleartext secrets to encrypted storage.
  if (!isEncryptedSecret(existingSecret)) {
    await persistEncryptedUserSecret(decrypted)
  }

  return decrypted
}

export function stripIdentityHashFromUrl(): boolean {
  if (typeof window === "undefined") {
    return false
  }
  const rawHash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash
  if (!rawHash || !looksLikeIdentityBootstrapHash(rawHash)) {
    return false
  }
  clearUrlHash()
  return true
}

export async function getOrCreateSessionIdentity(): Promise<{
  userId: string
  userSecret: string
}> {
  if (typeof window === "undefined") {
    return {
      userId: crypto.randomUUID(),
      userSecret: randomHex(32),
    }
  }

  const existingUserId = window.localStorage.getItem(USER_ID_KEY)
  const userId = isValidIdentityValue(existingUserId)
    ? existingUserId
    : crypto.randomUUID()
  if (!isValidIdentityValue(existingUserId)) {
    window.localStorage.setItem(USER_ID_KEY, userId)
  }

  const existingSecret = await readUserSecretFromStorage()
  if (existingSecret) {
    return { userId, userSecret: existingSecret }
  }

  const userSecret = randomHex(32)
  await persistEncryptedUserSecret(userSecret)
  return { userId, userSecret }
}

export async function consumeSessionIdentityFromHash(): Promise<{
  userId?: string
  userSecret?: string
  controlToken?: string
}> {
  if (typeof window === "undefined") {
    return {}
  }

  const rawHash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash
  if (!rawHash) {
    return {}
  }

  const params = new URLSearchParams(rawHash)
  const hashUserId = params.get("uid")
  const hashSecret = params.get("secret")
  const controlToken = params.get("ct") ?? undefined
  if (!isValidIdentityValue(hashUserId) || !isValidIdentityValue(hashSecret)) {
    stripIdentityHashFromUrl()
    return {}
  }

  window.localStorage.setItem(USER_ID_KEY, hashUserId)
  await persistEncryptedUserSecret(hashSecret)
  clearUrlHash()

  return {
    userId: hashUserId,
    userSecret: hashSecret,
    ...(isValidIdentityValue(controlToken ?? null)
      ? { controlToken }
      : {}),
  }
}

export function buildIdentityHash(
  userId: string,
  userSecret: string,
  controlToken?: string,
): string {
  const base = `uid=${encodeURIComponent(userId)}&secret=${encodeURIComponent(userSecret)}`
  if (!controlToken) return base
  return `${base}&ct=${encodeURIComponent(controlToken)}`
}

export function getPersistedUsername(): string | null {
  if (typeof window === "undefined") {
    return null
  }
  const username = window.localStorage.getItem(USERNAME_KEY)
  return isValidIdentityValue(username) ? username : null
}

export function persistUsername(username: string): void {
  if (typeof window === "undefined") {
    return
  }
  if (!isValidIdentityValue(username)) {
    return
  }
  window.localStorage.setItem(USERNAME_KEY, username.trim())
}
