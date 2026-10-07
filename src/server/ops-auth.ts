import { env } from "@/env"
import { timingSafeEqual } from "node:crypto"

function readBearerOrHeader(request: Request): string | null {
  const authorization = request.headers.get("authorization")
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice(7).trim()
    return token.length > 0 ? token : null
  }
  const header = request.headers.get("x-ops-secret")?.trim()
  return header && header.length > 0 ? header : null
}

function safeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) {
    return false
  }
  return timingSafeEqual(left, right)
}

/**
 * Gates operator HTTP endpoints. In production, OPS_SECRET must be set.
 * Returns an error Response when unauthorized; otherwise null.
 */
export function assertOpsAuthorized(request: Request): Response | null {
  const expected = env.OPS_SECRET
  if (!expected) {
    if (env.NODE_ENV === "production") {
      return Response.json(
        { error: "OPS_SECRET is not configured" },
        { status: 503 },
      )
    }
    // Dev convenience: allow when unset so local compose stays simple.
    return null
  }

  const provided = readBearerOrHeader(request)
  if (!provided || !safeEqualString(provided, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  return null
}

/** Run an ops handler only after `assertOpsAuthorized` succeeds. */
export async function withOpsAuth(
  request: Request,
  handler: () => Promise<Response>,
): Promise<Response> {
  const denied = assertOpsAuthorized(request)
  if (denied) return denied
  return handler()
}
