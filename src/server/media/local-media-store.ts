import { getAppNodeId } from "@/server/node-id"
import { getCommandClient } from "@/server/redis/client"
import { keys } from "@/server/redis/keys"
import { invalidateLocalMediaBlockCache } from "@/server/media/local-media-block-cache"

export type LocalMediaAbrVariant = {
  localMediaId: string
  height: number
  bandwidth: number
  label: string
}

export type LocalMediaAbrState = {
  status: "ready"
  durationSec: number
  variants: LocalMediaAbrVariant[]
}

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
  /** Set when this entry is a transcoded child of another local media id. */
  abrParentId?: string
  /** ABR ladder metadata on the parent entry after provider packaging. */
  abr?: LocalMediaAbrState
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
  abrParentId?: string
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
    abrParentId: input.abrParentId,
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
  const abr =
    entry.abr &&
    entry.abr.status === "ready" &&
    Array.isArray(entry.abr.variants)
      ? {
          status: "ready" as const,
          durationSec: Number(entry.abr.durationSec) || 0,
          variants: entry.abr.variants
            .filter(
              (v) =>
                typeof v?.localMediaId === "string" &&
                typeof v.height === "number" &&
                typeof v.bandwidth === "number",
            )
            .map((v) => ({
              localMediaId: v.localMediaId,
              height: v.height,
              bandwidth: v.bandwidth,
              label: typeof v.label === "string" ? v.label : `${v.height}p`,
            })),
        }
      : undefined

  return {
    ...entry,
    providerReady: entry.providerReady === true,
    providerNodeId:
      typeof entry.providerNodeId === "string" && entry.providerNodeId.length > 0
        ? entry.providerNodeId
        : undefined,
    abrParentId:
      typeof entry.abrParentId === "string" && entry.abrParentId.length > 0
        ? entry.abrParentId
        : undefined,
    abr: abr && abr.variants.length > 0 ? abr : undefined,
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
        const entry = normalizeEntry(JSON.parse(raw) as LocalMediaEntry)
        // Cascade ABR children when deleting a parent.
        if (entry.abr?.variants?.length) {
          for (const variant of entry.abr.variants) {
            if (variant.localMediaId === id) continue
            await deleteLocalMediaEntry(variant.localMediaId)
          }
        }
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

/** Replace ABR ladder metadata on a parent entry (caller manages children). */
export async function setLocalMediaAbr(
  id: string,
  abr: LocalMediaAbrState | null,
  opts?: { ownerUserId?: string },
) {
  const entry = await getLocalMediaEntry(id)
  if (!entry) return null
  if (opts?.ownerUserId && entry.ownerUserId !== opts.ownerUserId) {
    return null
  }
  if (abr) {
    entry.abr = abr
  } else {
    delete entry.abr
  }
  try {
    await persistEntry(entry)
  } catch (error) {
    console.warn("[local-media] redis abr write failed", error)
    return null
  }
  return entry
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
    await persistEntry(entry)
  } catch (error) {
    console.warn("[local-media] redis metadata touch failed", error)
    return null
  }
  return entry
}
