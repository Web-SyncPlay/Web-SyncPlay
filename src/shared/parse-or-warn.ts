import type { z } from "zod"

const REDACTED = "[redacted]"

/** True for credential-bearing keys; ignores booleans like joinPasswordEnabled. */
function isSecretKey(key: string): boolean {
  if (/^(?:password|secret|salt|hash|token|authorization|cookie)$/i.test(key)) {
    return true
  }
  return /(?:password(?:hash|salt)|(?:secret|salt|hash|token))$/i.test(key)
}

/** Deep-clone JSON-ish values while redacting secret-looking keys for logs. */
export function redactPayloadForLog(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]"
  if (value == null || typeof value !== "object") return value
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactPayloadForLog(item, depth + 1))
  }
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSecretKey(key)
      ? REDACTED
      : redactPayloadForLog(child, depth + 1)
  }
  return out
}

/**
 * safeParse with warn logging on failure.
 * Returns parsed data or null — caller drops invalid envelopes.
 * Failed payloads are redacted before console logging (no password/token dumps).
 */
export function parseOrWarn<T extends z.ZodType>(
  schema: T,
  payload: unknown,
  type: string,
  logPrefix = "[realtime]",
): z.infer<T> | null {
  const result = schema.safeParse(payload)
  if (!result.success) {
    console.warn(`${logPrefix} invalid ${type} payload`, {
      payload: redactPayloadForLog(payload),
      issues: result.error.issues,
    })
    return null
  }
  return result.data
}
