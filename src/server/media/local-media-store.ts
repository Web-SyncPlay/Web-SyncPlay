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
  createdAt: number
  expiresAt: number
}

/** Aligns with room state TTL — metadata only; bytes stay on the providing browser. */
const LOCAL_MEDIA_TTL_MS = 1000 * 60 * 60
const LOCAL_MEDIA_TTL_SECONDS = Math.floor(LOCAL_MEDIA_TTL_MS / 1000)

type MemorySlot = {
  entries: Map<string, LocalMediaEntry>
  ownerIndex: Map<string, Set<string>>
}

function memory(): MemorySlot {
  const g = globalThis as typeof globalThis & {
    __webSyncPlayLocalMediaMemory?: MemorySlot
  }
  if (!g.__webSyncPlayLocalMediaMemory) {
    g.__webSyncPlayLocalMediaMemory = {
      entries: new Map(),
      ownerIndex: new Map(),
    }
  }
  return g.__webSyncPlayLocalMediaMemory
}

function ownerIndexKey(roomId: string, ownerUserId: string) {
  return `${roomId}:${ownerUserId}`
}

function remember(entry: LocalMediaEntry) {
  const slot = memory()
  slot.entries.set(entry.id, entry)
  const key = ownerIndexKey(entry.roomId, entry.ownerUserId)
  const set = slot.ownerIndex.get(key) ?? new Set<string>()
  set.add(entry.id)
  slot.ownerIndex.set(key, set)
}

function forget(id: string, roomId?: string, ownerUserId?: string) {
  const slot = memory()
  const existing = slot.entries.get(id)
  slot.entries.delete(id)
  const rid = roomId ?? existing?.roomId
  const oid = ownerUserId ?? existing?.ownerUserId
  if (!rid || !oid) return
  const key = ownerIndexKey(rid, oid)
  const set = slot.ownerIndex.get(key)
  if (!set) return
  set.delete(id)
  if (set.size === 0) slot.ownerIndex.delete(key)
}

export async function createLocalMediaEntry(input: {
  id: string
  roomId: string
  ownerUserId: string
  filename: string
  mimeType: string
  sizeBytes: number
  /** Defaults false; set true when the provider already holds the File. */
  providerReady?: boolean
}) {
  const createdAt = Date.now()
  const entry: LocalMediaEntry = {
    id: input.id,
    roomId: input.roomId,
    ownerUserId: input.ownerUserId,
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    providerReady: input.providerReady ?? false,
    createdAt,
    expiresAt: createdAt + LOCAL_MEDIA_TTL_MS,
  }

  remember(entry)

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
    // Unit tests / Redis blips: process-local metadata still works for same-node relay.
    console.warn("[local-media] redis metadata write failed", error)
  }

  return entry
}

function normalizeEntry(entry: LocalMediaEntry): LocalMediaEntry {
  return {
    ...entry,
    providerReady: entry.providerReady === true,
  }
}

export async function getLocalMediaEntry(id: string) {
  try {
    const client = await getCommandClient()
    const raw = await client.get(keys.localMediaEntry(id))
    if (raw) {
      const entry = normalizeEntry(JSON.parse(raw) as LocalMediaEntry)
      if (entry.expiresAt <= Date.now()) {
        await client.del(keys.localMediaEntry(id))
        forget(id)
        return null
      }
      remember(entry)
      return entry
    }
  } catch {
    // Fall through to memory.
  }

  const cached = memory().entries.get(id)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    forget(id)
    return null
  }
  return normalizeEntry(cached)
}

async function persistEntry(entry: LocalMediaEntry) {
  remember(entry)
  try {
    const client = await getCommandClient()
    await client.set(keys.localMediaEntry(entry.id), JSON.stringify(entry), {
      EX: LOCAL_MEDIA_TTL_SECONDS,
    })
    await client.expire(
      keys.localMediaOwnerIndex(entry.roomId, entry.ownerUserId),
      LOCAL_MEDIA_TTL_SECONDS,
    )
  } catch (error) {
    console.warn("[local-media] redis metadata write failed", error)
  }
}

export async function setLocalMediaProviderReady(
  id: string,
  ready: boolean,
  opts?: { ownerUserId?: string },
) {
  const entry = await getLocalMediaEntry(id)
  if (!entry) return null
  if (opts?.ownerUserId && entry.ownerUserId !== opts.ownerUserId) {
    return null
  }
  if (entry.providerReady === ready) return entry
  entry.providerReady = ready
  await persistEntry(entry)
  return entry
}

/** Mark all of an owner's entries as not ready (e.g. any providing socket closed). */
export async function clearLocalMediaProviderReadyForOwner(
  roomId: string,
  ownerUserId: string,
) {
  const key = ownerIndexKey(roomId, ownerUserId)
  const memoryIds = [...(memory().ownerIndex.get(key) ?? new Set<string>())]
  let redisIds: string[] = []

  try {
    const client = await getCommandClient()
    redisIds = await client.sMembers(
      keys.localMediaOwnerIndex(roomId, ownerUserId),
    )
  } catch {
    // Memory index is enough for same-node.
  }

  const ids = new Set([...memoryIds, ...redisIds])
  await Promise.all(
    [...ids].map((id) => setLocalMediaProviderReady(id, false, { ownerUserId })),
  )
  return ids.size
}

export async function deleteLocalMediaEntry(id: string) {
  const cached = memory().entries.get(id)
  forget(id)
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
    if (!cached) {
      console.warn("[local-media] redis metadata delete failed", error)
    }
  }
}

export async function deleteLocalMediaEntriesForOwner(
  roomId: string,
  ownerUserId: string,
) {
  const key = ownerIndexKey(roomId, ownerUserId)
  const memoryIds = [...(memory().ownerIndex.get(key) ?? new Set<string>())]
  let redisIds: string[] = []

  try {
    const client = await getCommandClient()
    const indexKey = keys.localMediaOwnerIndex(roomId, ownerUserId)
    redisIds = await client.sMembers(indexKey)
    await client.del(indexKey)
  } catch (error) {
    console.warn("[local-media] redis owner index delete failed", error)
  }

  const ids = new Set([...memoryIds, ...redisIds])
  await Promise.all([...ids].map((id) => deleteLocalMediaEntry(id)))
  return ids.size
}

export async function touchLocalMediaEntry(id: string) {
  const entry = await getLocalMediaEntry(id)
  if (!entry) return null
  entry.expiresAt = Date.now() + LOCAL_MEDIA_TTL_MS
  remember(entry)

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
  }
  return entry
}
