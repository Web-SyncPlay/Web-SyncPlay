/**
 * Shared HTTP helpers for /api/media/local/* range and playlist routes.
 */

import {
  createLocalMediaByteStream,
  LocalMediaRelayError,
} from "@/server/media/local-media-relay"
import type { LocalMediaEntry } from "@/server/media/local-media-store"
import {
  httpStatusForLocalMediaError,
  localMediaErrorMessage,
  type LocalMediaErrorCode,
} from "@/lib/local-media-errors"
import {
  parseLocalMediaRangeHeader,
  type ResolvedBytesRange,
} from "@/lib/local-media-range"

export type ParsedLocalMediaRange = ResolvedBytesRange

export { parseLocalMediaRangeHeader }

export function localMediaJsonError(
  code: LocalMediaErrorCode,
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

export function localMediaInvalidRangeResponse(sizeBytes: number) {
  return new Response(null, {
    status: 416,
    headers: {
      "content-range": `bytes */${sizeBytes}`,
      "x-local-media-code": "invalid_range",
    },
  })
}

/** Build GET/HEAD byte-range (or full-body) responses over the relay stream. */
export function createLocalMediaRangeHttpResponse(input: {
  entry: LocalMediaEntry
  rangeInfo: ParsedLocalMediaRange | null
  method: "GET" | "HEAD"
  cacheControl: string
  logContext?: { mediaId: string }
}): Response {
  const { entry, rangeInfo, method, cacheControl } = input

  if (rangeInfo && "invalid" in rangeInfo) {
    return localMediaInvalidRangeResponse(entry.sizeBytes)
  }

  const headers = new Headers({
    "content-type": entry.mimeType,
    "accept-ranges": "bytes",
    "cache-control": cacheControl,
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
    if (input.logContext) {
      console.error("[local-media] relay failed", {
        mediaId: input.logContext.mediaId,
        roomId: entry.roomId,
        ownerUserId: entry.ownerUserId,
        start,
        end,
        code,
        error,
      })
    }
    return localMediaJsonError(code)
  }
}
