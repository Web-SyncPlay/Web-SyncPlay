import {
  createLocalMediaByteStream,
  ensureRelaySubscriber,
  LocalMediaRelayError,
} from "@/server/media/local-media-relay"
import {
  getLocalMediaEntry,
  touchLocalMediaEntry,
} from "@/server/media/local-media-store"
import { getRoomStateStore } from "@/server/redis/state-store"
import {
  httpStatusForLocalMediaError,
  localMediaErrorMessage,
} from "@/lib/local-media-errors"

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

async function handleLocalMediaRequest(
  request: Request,
  context: { params: Promise<{ id: string }> },
  method: "GET" | "HEAD",
) {
  void ensureRelaySubscriber()

  const { id } = await context.params
  const entry = await getLocalMediaEntry(id)
  if (!entry) {
    return errorResponse("not_found")
  }

  const store = await getRoomStateStore()
  const onlineUsers = await store.getWsPresenceUserIds(entry.roomId)
  if (!onlineUsers.has(entry.ownerUserId)) {
    return errorResponse("owner_offline")
  }

  if (!entry.providerReady) {
    return errorResponse("provider_unavailable")
  }

  // Keep metadata alive while viewers are actively pulling ranges.
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
    // Short private cache helps the same viewer rebuffer without re-hitting relay;
    // cross-viewer sharing is handled by the server block cache.
    "cache-control": "private, max-age=15",
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
    console.error("[local-media] relay failed", {
      mediaId: id,
      roomId: entry.roomId,
      ownerUserId: entry.ownerUserId,
      start,
      end,
      code,
      error,
    })
    return errorResponse(code)
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return await handleLocalMediaRequest(request, context, "GET")
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return await handleLocalMediaRequest(request, context, "HEAD")
}
