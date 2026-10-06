import { env } from "@/env"
import { createHash } from "node:crypto"

type CacheEntry = {
  body: string
  contentType: string
  expiresAt: number
}

const MAX_ENTRIES = 256
const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<CacheEntry>>()

function cacheKey(token: string, upstreamUrl: string) {
  return `${token}:${createHash("sha256").update(upstreamUrl).digest("hex").slice(0, 16)}`
}

function touch(key: string, entry: CacheEntry) {
  cache.delete(key)
  cache.set(key, entry)
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

export function peekHlsRewriteCache(
  token: string,
  upstreamUrl: string,
): { body: string; contentType: string } | null {
  if (env.HLS_REWRITE_CACHE_TTL_MS <= 0) return null
  const key = cacheKey(token, upstreamUrl)
  const hit = cache.get(key)
  if (!hit || hit.expiresAt <= Date.now()) {
    return null
  }
  touch(key, hit)
  return { body: hit.body, contentType: hit.contentType }
}

/**
 * Singleflight compute + LRU store. Call only after a cache miss / peek miss.
 */
export async function getOrComputeHlsRewrite(params: {
  token: string
  upstreamUrl: string
  compute: () => Promise<{ body: string; contentType: string }>
}): Promise<{ body: string; contentType: string; cacheHit: boolean }> {
  const ttl = env.HLS_REWRITE_CACHE_TTL_MS
  const key = cacheKey(params.token, params.upstreamUrl)

  if (ttl <= 0) {
    const computed = await params.compute()
    return { ...computed, cacheHit: false }
  }

  const now = Date.now()
  const hit = cache.get(key)
  if (hit && hit.expiresAt > now) {
    touch(key, hit)
    return { body: hit.body, contentType: hit.contentType, cacheHit: true }
  }

  const pending = inflight.get(key)
  if (pending) {
    const shared = await pending
    return { body: shared.body, contentType: shared.contentType, cacheHit: true }
  }

  const work = (async () => {
    const computed = await params.compute()
    const entry: CacheEntry = {
      body: computed.body,
      contentType: computed.contentType,
      expiresAt: Date.now() + ttl,
    }
    touch(key, entry)
    return entry
  })().finally(() => {
    inflight.delete(key)
  })

  inflight.set(key, work)
  const entry = await work
  return { body: entry.body, contentType: entry.contentType, cacheHit: false }
}

/** Test helper */
export function clearHlsRewriteCache() {
  cache.clear()
  inflight.clear()
}
