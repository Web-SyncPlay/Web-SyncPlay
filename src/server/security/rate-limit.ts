import { getCommandClient } from "@/server/redis/client"
import type { IncomingMessage } from "node:http"

type RateLimitResult = { allowed: boolean; remaining: number }

type TokenBucket = {
  tokens: number
  updatedAtMs: number
}

const tokenBuckets = new Map<string, TokenBucket>()
const TOKEN_BUCKET_STALE_MS = 5 * 60_000
const TOKEN_BUCKET_PRUNE_AT = 10_000

/**
 * In-process token bucket. Prefer this for hot per-message WS paths where a
 * Redis INCR on every frame would add load; use {@link consumeRateLimit} for
 * join/resolve and other cross-replica abusable endpoints.
 */
export function consumeTokenBucket(params: {
  key: string
  /** Max burst size. */
  capacity: number
  /** Steady-state refill rate. */
  refillPerSecond: number
  /** Tokens to spend (default 1). */
  cost?: number
  /** Injectable clock for tests. */
  nowMs?: number
}): RateLimitResult {
  const capacity = Math.max(1, params.capacity)
  const refillPerSecond = Math.max(0, params.refillPerSecond)
  const cost = Math.max(0, params.cost ?? 1)
  const nowMs = params.nowMs ?? Date.now()

  if (tokenBuckets.size >= TOKEN_BUCKET_PRUNE_AT) {
    pruneStaleTokenBuckets(nowMs)
  }

  let bucket = tokenBuckets.get(params.key)
  if (!bucket) {
    bucket = { tokens: capacity, updatedAtMs: nowMs }
    tokenBuckets.set(params.key, bucket)
  } else {
    const elapsedSec = Math.max(0, (nowMs - bucket.updatedAtMs) / 1000)
    bucket.tokens = Math.min(
      capacity,
      bucket.tokens + elapsedSec * refillPerSecond,
    )
    bucket.updatedAtMs = nowMs
  }

  if (bucket.tokens < cost) {
    return { allowed: false, remaining: Math.floor(bucket.tokens) }
  }

  bucket.tokens -= cost
  return {
    allowed: true,
    remaining: Math.floor(bucket.tokens),
  }
}

function pruneStaleTokenBuckets(nowMs: number) {
  for (const [key, bucket] of tokenBuckets) {
    if (nowMs - bucket.updatedAtMs >= TOKEN_BUCKET_STALE_MS) {
      tokenBuckets.delete(key)
    }
  }
}

/** Test-only: clear in-memory token buckets between cases. */
export function resetTokenBucketsForTests() {
  tokenBuckets.clear()
}

/**
 * Hot WS control events that fan out via Redis pub/sub (or write room state).
 * Limits are per `(roomId, userId)` and sized for normal scrubbing / presence
 * heartbeats with headroom — not for cross-replica join abuse.
 *
 * Client cadences (approx): seek preview ≥120ms; presence poll 500ms with 2s
 * heartbeat; seeks are user-driven.
 */
export const HOT_WS_EVENT_LIMITS = {
  "seek:preview": {
    keyPrefix: "ws:seek-preview",
    capacity: 48,
    refillPerSecond: 24,
  },
  "playback:seek": {
    keyPrefix: "ws:playback-seek",
    capacity: 30,
    refillPerSecond: 10,
  },
  "participant:update": {
    keyPrefix: "ws:participant-update",
    capacity: 30,
    refillPerSecond: 15,
  },
  /** ICE / SDP fan-out — bursts of candidates; binary LMC stays uncapped. */
  "local-media:webrtc:signal": {
    keyPrefix: "ws:local-media-webrtc-signal",
    capacity: 60,
    refillPerSecond: 20,
  },
  /** SFU transport setup — infrequent vs signaling. */
  "local-media:sfu:create-transport": {
    keyPrefix: "ws:local-media-sfu-create-transport",
    capacity: 12,
    refillPerSecond: 3,
  },
  "local-media:sfu:connect-transport": {
    keyPrefix: "ws:local-media-sfu-connect-transport",
    capacity: 24,
    refillPerSecond: 6,
  },
  "local-media:sfu:produce-data": {
    keyPrefix: "ws:local-media-sfu-produce-data",
    capacity: 24,
    refillPerSecond: 6,
  },
  "local-media:sfu:consume-data": {
    keyPrefix: "ws:local-media-sfu-consume-data",
    capacity: 36,
    refillPerSecond: 12,
  },
} as const

export type HotWsEventType = keyof typeof HOT_WS_EVENT_LIMITS

export function isHotWsEventType(type: string): type is HotWsEventType {
  return Object.hasOwn(HOT_WS_EVENT_LIMITS, type)
}

export function hotWsEventRateKey(
  type: HotWsEventType,
  roomId: string,
  userId: string,
): string {
  return `${HOT_WS_EVENT_LIMITS[type].keyPrefix}:${roomId}:${userId}`
}

/** Consume one token for a hot WS event; unknown types are always allowed. */
export function consumeHotWsEventLimit(params: {
  type: string
  roomId: string
  userId: string
  nowMs?: number
}): RateLimitResult {
  if (!isHotWsEventType(params.type)) {
    return { allowed: true, remaining: Number.POSITIVE_INFINITY }
  }
  const limit = HOT_WS_EVENT_LIMITS[params.type]
  return consumeTokenBucket({
    key: hotWsEventRateKey(params.type, params.roomId, params.userId),
    capacity: limit.capacity,
    refillPerSecond: limit.refillPerSecond,
    nowMs: params.nowMs,
  })
}

function normalizeHeaderValue(
  value: string | string[] | null | undefined,
): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  const trimmed = raw?.trim()
  return trimmed || undefined
}

/**
 * Shared hop semantics for client IP (rate keys + viewer-capability binding).
 * Prefers the first `X-Forwarded-For` hop, then `X-Real-IP`.
 * Returns `undefined` when neither header yields an IP.
 */
export function clientIpFromForwardingHeaders(headers: {
  forwardedFor?: string | string[] | null
  realIp?: string | string[] | null
}): string | undefined {
  const forwarded = normalizeHeaderValue(headers.forwardedFor)
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }
  return normalizeHeaderValue(headers.realIp)
}

/**
 * Redis fixed-window rate limiter (INCR + EXPIRE).
 * Fail-closed on Redis errors by default so abusable endpoints stay protected
 * during Valkey outages. Pass `failOpen: true` only for non-abusable reads.
 */
export async function consumeRateLimit(params: {
  key: string
  limit: number
  windowMs: number
  /** Allow the request when Redis is unavailable. Default: deny. */
  failOpen?: boolean
}): Promise<RateLimitResult> {
  const windowSeconds = Math.max(1, Math.ceil(params.windowMs / 1000))
  const redisKey = `rate:${params.key}`

  try {
    const client = await getCommandClient()
    const count = await client.incr(redisKey)
    // Fixed window: set TTL only on the first hit so traffic cannot extend the window.
    if (count === 1) {
      await client.expire(redisKey, windowSeconds)
    }

    if (count > params.limit) {
      return { allowed: false, remaining: 0 }
    }

    return {
      allowed: true,
      remaining: Math.max(0, params.limit - count),
    }
  } catch (error) {
    if (params.failOpen) {
      console.warn(
        "[rate-limit] redis unavailable; allowing request (failOpen)",
        error,
      )
      return { allowed: true, remaining: params.limit }
    }
    console.warn("[rate-limit] redis unavailable; denying request", error)
    return { allowed: false, remaining: 0 }
  }
}

/**
 * Best-effort client IP from a Fetch `Request` (HTTP validate / rate keys).
 * Same header hop semantics as {@link clientIpFromUpgradeRequest}; falls back
 * to `"unknown"` when no socket is available.
 */
export function clientIpFromRequest(request: Request): string {
  return (
    clientIpFromForwardingHeaders({
      forwardedFor: request.headers.get("x-forwarded-for"),
      realIp: request.headers.get("x-real-ip"),
    }) || "unknown"
  )
}

/**
 * Best-effort client IP from an HTTP upgrade `IncomingMessage` (WS mint).
 * Same header hop semantics as {@link clientIpFromRequest}; falls back to
 * `socket.remoteAddress`, then `"unknown"`.
 */
export function clientIpFromUpgradeRequest(req: IncomingMessage): string {
  return (
    clientIpFromForwardingHeaders({
      forwardedFor: req.headers["x-forwarded-for"],
      realIp: req.headers["x-real-ip"],
    }) ||
    req.socket?.remoteAddress?.trim() ||
    "unknown"
  )
}
