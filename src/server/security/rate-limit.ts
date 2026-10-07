import { getCommandClient } from "@/server/redis/client"

type RateLimitResult = { allowed: boolean; remaining: number }

/**
 * Redis fixed-window rate limiter (INCR + EXPIRE).
 * Fail-open on Redis errors so rooms stay available during Valkey blips.
 */
export async function consumeRateLimit(params: {
  key: string
  limit: number
  windowMs: number
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
    console.warn("[rate-limit] redis unavailable; allowing request", error)
    return { allowed: true, remaining: params.limit }
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
