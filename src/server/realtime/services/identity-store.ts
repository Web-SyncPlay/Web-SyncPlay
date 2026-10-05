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
  const existing = await client.hGet(keys.roomIdentity(params.roomId), params.userId)
  if (!existing) return false
  return existing === params.userSecret
}

export async function clearRoomIdentities(roomId: string): Promise<void> {
  const client = await getCommandClient()
  await client.del(keys.roomIdentity(roomId))
}
