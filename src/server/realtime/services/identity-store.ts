import { getCommandClient } from "@/server/redis/client"
import { keys } from "@/server/redis/keys"
import { roomStateTtlSeconds } from "@/zod/types"

/**
 * Redis-backed identity secrets so verification survives restarts / multi-instance.
 * First claim wins; later joins must match.
 */
export async function claimOrVerifyIdentitySecret(params: {
  roomId: string
  userId: string
  userSecret: string
}): Promise<boolean> {
  const client = await getCommandClient()
  const key = keys.roomIdentity(params.roomId)
  const existing = await client.hGet(key, params.userId)
  if (!existing) {
    await client.hSet(key, params.userId, params.userSecret)
    await client.expire(key, roomStateTtlSeconds)
    return true
  }
  await client.expire(key, roomStateTtlSeconds)
  return existing === params.userSecret
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
  if (existing !== params.userSecret) return false
  await client.expire(key, roomStateTtlSeconds)
  return true
}

export async function clearRoomIdentities(roomId: string): Promise<void> {
  const client = await getCommandClient()
  await client.del(keys.roomIdentity(roomId))
}
