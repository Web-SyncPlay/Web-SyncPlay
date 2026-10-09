import { getCommandClient } from "@/server/redis/client"

type RateLimitResult = { allowed: boolean; remaining: number }

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
 * Best-effort client IP for rate keys. Prefers the first `X-Forwarded-For`
 * hop (typical reverse-proxy layout), then `X-Real-IP`.
 */
export function clientIpFromRequest(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown"
}
