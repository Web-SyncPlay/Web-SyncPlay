/**
 * HTTP façade for GET/HEAD /api/media/local/internal/[id].
 */

import { env } from "@/env"
import {
  createLocalMediaRangeHttpResponse,
  localMediaJsonError,
  parseLocalMediaRangeHeader,
} from "@/server/media/local-media-http"
import {
  getLocalMediaEntry,
  touchLocalMediaEntry,
} from "@/server/media/local-media-store"
import { timingSafeEqual } from "node:crypto"

function authorizeInternal(request: Request): boolean {
  const expected = env.LOCAL_MEDIA_INTERNAL_SECRET?.trim()
  if (!expected) {
    return false
  }
  const provided = request.headers.get("x-local-media-internal")?.trim()
  if (!provided || provided.length !== expected.length) {
    return false
  }
  try {
    return timingSafeEqual(
      Buffer.from(provided, "utf8"),
      Buffer.from(expected, "utf8"),
    )
  } catch {
    return false
  }
}

/**
 * Holder-node-only range endpoint used by peer replicas for provider affinity.
 * Not for browsers — requires X-Local-Media-Internal secret.
 */
export async function handleLocalMediaInternalRange(
  request: Request,
  id: string,
  method: "GET" | "HEAD",
): Promise<Response> {
  if (!authorizeInternal(request)) {
    return new Response(null, { status: 403 })
  }

  const entry = await getLocalMediaEntry(id)
  if (!entry) {
    return localMediaJsonError("not_found")
  }
  if (!entry.providerReady) {
    return localMediaJsonError("provider_unavailable")
  }

  void touchLocalMediaEntry(id)

  return createLocalMediaRangeHttpResponse({
    entry,
    rangeInfo: parseLocalMediaRangeHeader(
      request.headers.get("range"),
      entry.sizeBytes,
    ),
    method,
    cacheControl: "private, no-store",
  })
}
