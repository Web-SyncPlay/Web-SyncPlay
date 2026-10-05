type Bucket = {
  timestamps: number[]
}

const buckets = new Map<string, Bucket>()

function prune(bucket: Bucket, windowMs: number, now: number) {
  const cutoff = now - windowMs
  while (bucket.timestamps.length > 0 && bucket.timestamps[0]! < cutoff) {
    bucket.timestamps.shift()
  }
}

/**
 * Simple in-process sliding-window rate limiter.
 * Suitable for single-node Docker deploys; multi-node needs Redis later.
 */
export function consumeRateLimit(params: {
  key: string
  limit: number
  windowMs: number
}): { allowed: boolean; remaining: number } {
  const now = Date.now()
  const bucket = buckets.get(params.key) ?? { timestamps: [] }
  prune(bucket, params.windowMs, now)
  if (bucket.timestamps.length === 0) {
    buckets.delete(params.key)
  }
  if (bucket.timestamps.length >= params.limit) {
    buckets.set(params.key, bucket)
    return { allowed: false, remaining: 0 }
  }
  bucket.timestamps.push(now)
  buckets.set(params.key, bucket)

  // Opportunistic GC so idle keys do not linger forever in long-lived processes.
  if (buckets.size > 2_000) {
    for (const [key, idle] of buckets) {
      prune(idle, params.windowMs, now)
      if (idle.timestamps.length === 0) {
        buckets.delete(key)
      }
    }
  }

  return {
    allowed: true,
    remaining: Math.max(0, params.limit - bucket.timestamps.length),
  }
}

export function clientIpFromRequest(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown"
}
