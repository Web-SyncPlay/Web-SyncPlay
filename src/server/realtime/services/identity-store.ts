import { createHash, timingSafeEqual } from "node:crypto"
import { getCommandClient } from "@/server/redis/client"
import { keys } from "@/server/redis/keys"
import { roomStateTtlSeconds } from "@/zod/types"

const IDENTITY_SECRET_HASH_PREFIX = "h1:"

function hashIdentitySecret(userSecret: string): string {
  return (
    IDENTITY_SECRET_HASH_PREFIX +
    createHash("sha256").update(userSecret).digest("hex")
  )
}

function isHashedIdentitySecret(value: string): boolean {
  return value.startsWith(IDENTITY_SECRET_HASH_PREFIX)
}

function secretsMatch(stored: string, userSecret: string): boolean {
  if (isHashedIdentitySecret(stored)) {
    const expected = hashIdentitySecret(userSecret)
    const storedBytes = Buffer.from(stored)
    const expectedBytes = Buffer.from(expected)
    if (storedBytes.length !== expectedBytes.length) {
      return false
    }
    return timingSafeEqual(storedBytes, expectedBytes)
  }

  // Legacy cleartext entries (pre-hash migration).
  const storedBytes = Buffer.from(stored)
  const providedBytes = Buffer.from(userSecret)
  if (storedBytes.length !== providedBytes.length) {
    return false
  }
  return timingSafeEqual(storedBytes, providedBytes)
}

async function touchIdentityKey(
  client: Awaited<ReturnType<typeof getCommandClient>>,
  key: string,
) {
  await client.expire(key, roomStateTtlSeconds)
}

/** Verify stored secret; migrate legacy cleartext to hash. Does not claim. */
async function verifyAndMaybeMigrate(params: {
  client: Awaited<ReturnType<typeof getCommandClient>>
  key: string
  userId: string
  userSecret: string
  existing: string
}): Promise<boolean> {
  const { client, key, userId, userSecret, existing } = params
  if (!secretsMatch(existing, userSecret)) {
    await touchIdentityKey(client, key)
    return false
  }

  if (!isHashedIdentitySecret(existing)) {
    await client.hSet(key, userId, hashIdentitySecret(userSecret))
  }
  await touchIdentityKey(client, key)
  return true
}

/**
 * Redis-backed identity secret hashes so verification survives restarts /
 * multi-instance. First claim wins; later joins must match.
 */
export async function claimOrVerifyIdentitySecret(params: {
  roomId: string
  userId: string
  userSecret: string
}): Promise<boolean> {
  const client = await getCommandClient()
  const key = keys.roomIdentity(params.roomId)
  const existing = await client.hGet(key, params.userId)
  const secretHash = hashIdentitySecret(params.userSecret)

  if (!existing) {
    await client.hSet(key, params.userId, secretHash)
    await touchIdentityKey(client, key)
    return true
  }

  return verifyAndMaybeMigrate({
    client,
    key,
    userId: params.userId,
    userSecret: params.userSecret,
    existing,
  })
}

/** Verify only — does not claim a new identity (for HTTP upload auth). */
export async function matchIdentitySecret(params: {
  roomId: string
  userId: string
  userSecret: string
}): Promise<boolean> {
  const client = await getCommandClient()
  const key = keys.roomIdentity(params.roomId)
  const existing = await client.hGet(key, params.userId)
  if (!existing) return false

  return verifyAndMaybeMigrate({
    client,
    key,
    userId: params.userId,
    userSecret: params.userSecret,
    existing,
  })
}

export async function clearRoomIdentities(roomId: string): Promise<void> {
  const client = await getCommandClient()
  await client.del(keys.roomIdentity(roomId))
}
