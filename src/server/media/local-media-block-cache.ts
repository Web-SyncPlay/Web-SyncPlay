import { env } from "@/env"
import { getCommandClient } from "@/server/redis/client"
import { keys } from "@/server/redis/keys"
import { RESP_TYPES } from "redis"

type BlockEntry = {
  bytes: Uint8Array
  expiresAt: number
  byteLength: number
}

type CacheSlot = {
  blocks: Map<string, BlockEntry>
  inflight: Map<string, Promise<Uint8Array>>
  totalBytes: number
}

const DEFAULT_TTL_MS = 120_000
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024
const REDIS_WARN_INTERVAL_MS = 30_000
const REDIS_BACKOFF_MS = 5_000

function cacheTtlMs() {
  const raw = env.LOCAL_MEDIA_BLOCK_CACHE_TTL_MS
  // When SKIP_ENV_VALIDATION is set (unit tests), zod defaults may be absent.
  return typeof raw === "number" && Number.isFinite(raw) ? raw : DEFAULT_TTL_MS
}

function cacheTtlSeconds() {
  return Math.max(1, Math.ceil(cacheTtlMs() / 1000))
}

function cacheMaxBytes() {
  const raw = env.LOCAL_MEDIA_BLOCK_CACHE_MAX_BYTES
  return typeof raw === "number" && Number.isFinite(raw) ? raw : DEFAULT_MAX_BYTES
}

function slot(): CacheSlot {
  const g = globalThis as typeof globalThis & {
    __webSyncPlayLocalMediaBlockCache?: CacheSlot
  }
  if (!g.__webSyncPlayLocalMediaBlockCache) {
    g.__webSyncPlayLocalMediaBlockCache = {
      blocks: new Map(),
      inflight: new Map(),
      totalBytes: 0,
    }
  }
  return g.__webSyncPlayLocalMediaBlockCache
}

function blockKey(mediaId: string, blockStart: number) {
  return `${mediaId}:${blockStart}`
}

function evictIfNeeded(incomingBytes: number) {
  const maxBytes = cacheMaxBytes()
  if (maxBytes <= 0) return
  const s = slot()
  while (s.totalBytes + incomingBytes > maxBytes && s.blocks.size > 0) {
    const oldest = s.blocks.keys().next().value
    if (oldest === undefined) break
    const entry = s.blocks.get(oldest)
    s.blocks.delete(oldest)
    if (entry) s.totalBytes -= entry.byteLength
  }
}

function touch(key: string, entry: BlockEntry) {
  const s = slot()
  s.blocks.delete(key)
  s.blocks.set(key, entry)
}

function putL1(key: string, bytes: Uint8Array, ttlMs: number) {
  const s = slot()
  evictIfNeeded(bytes.byteLength)
  const entry: BlockEntry = {
    bytes,
    byteLength: bytes.byteLength,
    expiresAt: Date.now() + ttlMs,
  }
  const previous = s.blocks.get(key)
  if (previous) s.totalBytes -= previous.byteLength
  touch(key, entry)
  s.totalBytes += entry.byteLength
}

let redisWarnAt = 0
let redisDisabledUntil = 0

function warnRedis(op: string, error: unknown) {
  const now = Date.now()
  if (now - redisWarnAt < REDIS_WARN_INTERVAL_MS) return
  redisWarnAt = now
  console.warn(`[local-media-block-cache] redis ${op} failed`, error)
}

function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

async function redisGetBlock(
  mediaId: string,
  blockStart: number,
): Promise<Uint8Array | null> {
  if (Date.now() < redisDisabledUntil) return null
  try {
    const client = await getCommandClient()
    const raw = await client
      .withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer })
      .get(keys.localMediaBlock(mediaId, blockStart))
    if (raw == null) return null
    // Copy so L1 does not alias redis client buffers.
    if (Buffer.isBuffer(raw)) return Uint8Array.from(raw)
    return Uint8Array.from(Buffer.from(raw))
  } catch (error) {
    redisDisabledUntil = Date.now() + REDIS_BACKOFF_MS
    warnRedis("get", error)
    return null
  }
}

async function redisSetBlock(
  mediaId: string,
  blockStart: number,
  bytes: Uint8Array,
) {
  if (Date.now() < redisDisabledUntil) return
  try {
    const client = await getCommandClient()
    const ex = cacheTtlSeconds()
    const blockRedisKey = keys.localMediaBlock(mediaId, blockStart)
    const indexKey = keys.localMediaBlockIndex(mediaId)
    await client.set(blockRedisKey, toBuffer(bytes), { EX: ex })
    await client.sAdd(indexKey, String(blockStart))
    await client.expire(indexKey, ex)
  } catch (error) {
    redisDisabledUntil = Date.now() + REDIS_BACKOFF_MS
    warnRedis("set", error)
  }
}

async function redisInvalidateBlocks(mediaId: string) {
  if (Date.now() < redisDisabledUntil) return
  try {
    const client = await getCommandClient()
    const indexKey = keys.localMediaBlockIndex(mediaId)
    const starts = await client.sMembers(indexKey)
    const toDelete = [
      indexKey,
      ...starts.map((start) => keys.localMediaBlock(mediaId, Number(start))),
    ]
    if (toDelete.length > 0) {
      await client.del(toDelete)
    }
  } catch (error) {
    redisDisabledUntil = Date.now() + REDIS_BACKOFF_MS
    warnRedis("invalidate", error)
  }
}

function clearL1ForMedia(mediaId: string) {
  const s = slot()
  for (const key of [...s.blocks.keys()]) {
    if (!key.startsWith(`${mediaId}:`)) continue
    const entry = s.blocks.get(key)
    s.blocks.delete(key)
    if (entry) s.totalBytes -= entry.byteLength
  }
  for (const key of [...s.inflight.keys()]) {
    if (key.startsWith(`${mediaId}:`)) {
      s.inflight.delete(key)
    }
  }
}

export async function invalidateLocalMediaBlockCache(mediaId: string) {
  clearL1ForMedia(mediaId)
  await redisInvalidateBlocks(mediaId)
}

export function invalidateAllLocalMediaBlockCache() {
  const s = slot()
  s.blocks.clear()
  s.inflight.clear()
  s.totalBytes = 0
}

/**
 * Fetch one aligned provider block with process-local LRU (L1), Redis/Valkey
 * shared cache (L2), and singleflight. Concurrent viewers requesting overlapping
 * ranges share one provider upload per instance; other instances reuse Redis.
 */
export async function getOrFetchLocalMediaBlock(params: {
  mediaId: string
  blockStart: number
  fetch: () => Promise<Uint8Array>
}): Promise<{ bytes: Uint8Array; cacheHit: boolean }> {
  const ttl = cacheTtlMs()
  const key = blockKey(params.mediaId, params.blockStart)
  const s = slot()

  if (ttl <= 0) {
    return { bytes: await params.fetch(), cacheHit: false }
  }

  const now = Date.now()
  const hit = s.blocks.get(key)
  if (hit && hit.expiresAt > now) {
    touch(key, hit)
    return { bytes: hit.bytes, cacheHit: true }
  }

  const pending = s.inflight.get(key)
  if (pending) {
    const shared = await pending
    return { bytes: shared, cacheHit: true }
  }

  // Reserve the inflight slot before the first await so concurrent callers coalesce.
  let settle!: (bytes: Uint8Array) => void
  let fail!: (error: unknown) => void
  const work = new Promise<Uint8Array>((resolve, reject) => {
    settle = resolve
    fail = reject
  })
  s.inflight.set(key, work)

  let fromCache = false

  void (async () => {
    try {
      const redisBytes = await redisGetBlock(params.mediaId, params.blockStart)
      if (redisBytes) {
        putL1(key, redisBytes, ttl)
        fromCache = true
        settle(redisBytes)
        return
      }

      const bytes = await params.fetch()
      putL1(key, bytes, ttl)
      await redisSetBlock(params.mediaId, params.blockStart, bytes)
      settle(bytes)
    } catch (error) {
      fail(error)
    } finally {
      s.inflight.delete(key)
    }
  })()

  const bytes = await work
  return { bytes, cacheHit: fromCache }
}

/** Test helper */
export function localMediaBlockCacheStats() {
  const s = slot()
  return { entries: s.blocks.size, totalBytes: s.totalBytes }
}
