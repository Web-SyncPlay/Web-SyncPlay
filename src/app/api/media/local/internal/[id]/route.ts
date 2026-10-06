import { env } from "@/env"
import {
  createLocalMediaByteStream,
  LocalMediaRelayError,
} from "@/server/media/local-media-relay"
import {
  getLocalMediaEntry,
  touchLocalMediaEntry,
} from "@/server/media/local-media-store"
import {
  httpStatusForLocalMediaError,
  localMediaErrorMessage,
} from "@/lib/local-media-errors"
import { timingSafeEqual } from "node:crypto"

function parseRangeHeader(rangeHeader: string | null, totalLength: number) {
  if (!rangeHeader) {
    return null
  }
  const match = /^bytes=(\d+)-(\d+)?$/i.exec(rangeHeader.trim())
  if (!match) {
    return null
  }
  const start = Number.parseInt(match[1] ?? "0", 10)
  const end = Number.parseInt(match[2] ?? `${totalLength - 1}`, 10)
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null
  }
  if (start < 0 || end < start || start >= totalLength) {
    return { invalid: true as const }
  }
  return {
    start,
    end: Math.min(end, totalLength - 1),
  }
}

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

function errorResponse(
  code: Parameters<typeof localMediaErrorMessage>[0],
  extra?: Record<string, string>,
) {
  return Response.json(
    {
      error: localMediaErrorMessage(code),
      code,
      ...extra,
    },
    { status: httpStatusForLocalMediaError(code) },
  )
}

/**
 * Holder-node-only range endpoint used by peer replicas for provider affinity.
 * Not for browsers — requires X-Local-Media-Internal secret.
 */
async function handleInternal(
  request: Request,
  context: { params: Promise<{ id: string }> },
  method: "GET" | "HEAD",
) {
  if (!authorizeInternal(request)) {
    return new Response(null, { status: 403 })
  }

  const { id } = await context.params
  const entry = await getLocalMediaEntry(id)
  if (!entry) {
    return errorResponse("not_found")
  }
  if (!entry.providerReady) {
    return errorResponse("provider_unavailable")
  }

  void touchLocalMediaEntry(id)

  const rangeInfo = parseRangeHeader(
    request.headers.get("range"),
    entry.sizeBytes,
  )
  if (rangeInfo?.invalid) {
    return new Response(null, {
      status: 416,
      headers: {
        "content-range": `bytes */${entry.sizeBytes}`,
        "x-local-media-code": "invalid_range",
      },
    })
  }

  const headers = new Headers({
    "content-type": entry.mimeType,
    "accept-ranges": "bytes",
    "cache-control": "private, no-store",
  })

  const start = rangeInfo?.start ?? 0
  const end = rangeInfo?.end ?? entry.sizeBytes - 1
  const chunkLength = end - start + 1

  if (rangeInfo) {
    headers.set("content-length", String(chunkLength))
    headers.set(
      "content-range",
      `bytes ${start}-${end}/${entry.sizeBytes}`,
    )
  } else {
    headers.set("content-length", String(entry.sizeBytes))
  }

  if (method === "HEAD") {
    return new Response(null, {
      status: rangeInfo ? 206 : 200,
      headers,
    })
  }

  try {
    const stream = createLocalMediaByteStream(entry, start, end)
    return new Response(stream, {
      status: rangeInfo ? 206 : 200,
      headers,
    })
  } catch (error) {
    const code =
      error instanceof LocalMediaRelayError ? error.code : "relay_failed"
    return errorResponse(code)
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return await handleInternal(request, context, "GET")
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return await handleInternal(request, context, "HEAD")
}
