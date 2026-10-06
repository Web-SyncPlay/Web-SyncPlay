import { getAppNodeId } from "@/server/node-id"
import { getCommandClient } from "@/server/redis/client"
import { keys } from "@/server/redis/keys"
import { invalidateLocalMediaBlockCache } from "@/server/media/local-media-block-cache"

export type LocalMediaEntry = {
  id: string
  roomId: string
  ownerUserId: string
  filename: string
  mimeType: string
  sizeBytes: number
  /** True while the owning browser tab still holds the File for relay. */
  providerReady: boolean
  /**
   * APP_NODE_ID of the process that last marked this entry ready (provider WS).
   * Cleared when providerReady becomes false.
   */
  providerNodeId?: string
  createdAt: number
  expiresAt: number
}

/** Aligns with room state TTL — metadata only; bytes stay on the providing browser. */
const LOCAL_MEDIA_TTL_MS = 1000 * 60 * 60
const LOCAL_MEDIA_TTL_SECONDS = Math.floor(LOCAL_MEDIA_TTL_MS / 1000)

export async function createLocalMediaEntry(input: {
  id: string
  roomId: string
  ownerUserId: string
  filename: string
  mimeType: string
  sizeBytes: number
  /** Defaults false; set true when the provider already holds the File. */
  providerReady?: boolean
  /** Defaults to this process when providerReady is true. */
  providerNodeId?: string
}) {
  const createdAt = Date.now()
  const providerReady = input.providerReady ?? false
  const entry: LocalMediaEntry = {
    id: input.id,
    roomId: input.roomId,
    ownerUserId: input.ownerUserId,
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    providerReady,
    providerNodeId: providerReady
      ? (input.providerNodeId ?? getAppNodeId())
      : undefined,
    createdAt,
    expiresAt: createdAt + LOCAL_MEDIA_TTL_MS,
  }

  try {
    const client = await getCommandClient()
    await client.set(keys.localMediaEntry(input.id), JSON.stringify(entry), {
      EX: LOCAL_MEDIA_TTL_SECONDS,
    })
    await client.sAdd(
      keys.localMediaOwnerIndex(input.roomId, input.ownerUserId),
      input.id,
    )
    await client.expire(
      keys.localMediaOwnerIndex(input.roomId, input.ownerUserId),
      LOCAL_MEDIA_TTL_SECONDS,
    )
  } catch (error) {
    console.warn("[local-media] redis metadata write failed", error)
    throw error
  }

  return entry
}

function normalizeEntry(entry: LocalMediaEntry): LocalMediaEntry {
  return {
    ...entry,
    providerReady: entry.providerReady === true,
    providerNodeId:
      typeof entry.providerNodeId === "string" && entry.providerNodeId.length > 0
        ? entry.providerNodeId
        : undefined,
  }
}

export async function getLocalMediaEntry(id: string) {
  try {
    const client = await getCommandClient()
    const raw = await client.get(keys.localMediaEntry(id))
    if (!raw) return null
    const entry = normalizeEntry(JSON.parse(raw) as LocalMediaEntry)
    if (entry.expiresAt <= Date.now()) {
      await client.del(keys.localMediaEntry(id))
      return null
    }
    return entry
  } catch (error) {
    console.warn("[local-media] redis metadata read failed", error)
    return null
  }
}

async function persistEntry(entry: LocalMediaEntry) {
  const client = await getCommandClient()
  await client.set(keys.localMediaEntry(entry.id), JSON.stringify(entry), {
    EX: LOCAL_MEDIA_TTL_SECONDS,
  })
  await client.expire(
    keys.localMediaOwnerIndex(entry.roomId, entry.ownerUserId),
    LOCAL_MEDIA_TTL_SECONDS,
  )
}

/**
 * Update provider readiness. When `ready` is true, always stamps
 * `providerNodeId` to this process (even if already ready) so reconnects
 * onto a new replica update affinity.
 */
export async function setLocalMediaProviderReady(
  id: string,
  ready: boolean,
  opts?: { ownerUserId?: string; providerNodeId?: string },
) {
  const entry = await getLocalMediaEntry(id)
  if (!entry) return null
  if (opts?.ownerUserId && entry.ownerUserId !== opts.ownerUserId) {
    return null
  }

  const nextNodeId = ready
    ? (opts?.providerNodeId ?? getAppNodeId())
    : undefined
  const readyUnchanged = entry.providerReady === ready
  const nodeUnchanged = entry.providerNodeId === nextNodeId
  if (readyUnchanged && nodeUnchanged) {
    return entry
  }

  entry.providerReady = ready
  if (ready) {
    entry.providerNodeId = nextNodeId
  } else {
    delete entry.providerNodeId
  }

  try {
    await persistEntry(entry)
  } catch (error) {
    console.warn("[local-media] redis metadata write failed", error)
    return null
  }
  return entry
}

/** Mark all of an owner's entries as not ready (e.g. any providing socket closed). */
export async function clearLocalMediaProviderReadyForOwner(
  roomId: string,
  ownerUserId: string,
) {
  let redisIds: string[] = []

  try {
    const client = await getCommandClient()
    redisIds = await client.sMembers(
      keys.localMediaOwnerIndex(roomId, ownerUserId),
    )
  } catch (error) {
    console.warn("[local-media] redis owner index read failed", error)
    return 0
  }

  await Promise.all(
    redisIds.map((id) =>
      setLocalMediaProviderReady(id, false, { ownerUserId }),
    ),
  )
  return redisIds.length
}

export async function deleteLocalMediaEntry(id: string) {
  await invalidateLocalMediaBlockCache(id)

  try {
    const client = await getCommandClient()
    const raw = await client.get(keys.localMediaEntry(id))
    if (raw) {
      try {
        const entry = JSON.parse(raw) as LocalMediaEntry
        await client.del(keys.localMediaEntry(id))
        await client.sRem(
          keys.localMediaOwnerIndex(entry.roomId, entry.ownerUserId),
          id,
        )
        return
      } catch {
        // Fall through.
      }
    }
    await client.del(keys.localMediaEntry(id))
  } catch (error) {
    console.warn("[local-media] redis metadata delete failed", error)
  }
}

export async function deleteLocalMediaEntriesForOwner(
  roomId: string,
  ownerUserId: string,
) {
  let redisIds: string[] = []

  try {
    const client = await getCommandClient()
    const indexKey = keys.localMediaOwnerIndex(roomId, ownerUserId)
    redisIds = await client.sMembers(indexKey)
    await client.del(indexKey)
  } catch (error) {
    console.warn("[local-media] redis owner index delete failed", error)
    return 0
  }

  await Promise.all(redisIds.map((id) => deleteLocalMediaEntry(id)))
  return redisIds.length
}

export async function touchLocalMediaEntry(id: string) {
  const entry = await getLocalMediaEntry(id)
  if (!entry) return null
  entry.expiresAt = Date.now() + LOCAL_MEDIA_TTL_MS

  try {
    const client = await getCommandClient()
    await client.set(keys.localMediaEntry(id), JSON.stringify(entry), {
      EX: LOCAL_MEDIA_TTL_SECONDS,
    })
    await client.expire(
      keys.localMediaOwnerIndex(entry.roomId, entry.ownerUserId),
      LOCAL_MEDIA_TTL_SECONDS,
    )
  } catch (error) {
    console.warn("[local-media] redis metadata touch failed", error)
    return null
  }
  return entry
}
