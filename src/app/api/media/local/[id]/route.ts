import { getLocalMediaEntry } from "@/server/media/local-media-store"
import { getRoomStateStore } from "@/server/redis/state-store"
import { NextResponse } from "next/server"
import { createReadStream } from "node:fs"
import { Readable } from "node:stream"

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

async function handleLocalMediaRequest(
  request: Request,
  context: { params: Promise<{ id: string }> },
  method: "GET" | "HEAD",
) {
  const { id } = await context.params
  const entry = await getLocalMediaEntry(id)
  if (!entry) {
    return NextResponse.json({ error: "Local media not found" }, { status: 404 })
  }

  const store = await getRoomStateStore()
  const onlineUsers = await store.getWsPresenceUserIds(entry.roomId)
  if (!onlineUsers.has(entry.ownerUserId)) {
    return NextResponse.json(
      { error: "Local media owner is offline" },
      { status: 503 },
    )
  }

  const rangeInfo = parseRangeHeader(
    request.headers.get("range"),
    entry.sizeBytes,
  )
  if (rangeInfo?.invalid) {
    return new Response(null, {
      status: 416,
      headers: {
        "content-range": `bytes */${entry.sizeBytes}`,
      },
    })
  }

  const headers = new Headers({
    "content-type": entry.mimeType,
    "accept-ranges": "bytes",
    "cache-control": "private, no-store",
  })

  if (!rangeInfo) {
    headers.set("content-length", String(entry.sizeBytes))
    if (method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers,
      })
    }
    // Stream the file — never buffer entire uploads (up to LOCAL_MEDIA_MAX_BYTES) in RAM.
    const stream = Readable.toWeb(
      createReadStream(entry.tempFilePath),
    ) as unknown as ReadableStream
    return new Response(stream, {
      status: 200,
      headers,
    })
  }

  const chunkLength = rangeInfo.end - rangeInfo.start + 1
  headers.set("content-length", String(chunkLength))
  headers.set(
    "content-range",
    `bytes ${rangeInfo.start}-${rangeInfo.end}/${entry.sizeBytes}`,
  )
  if (method === "HEAD") {
    return new Response(null, {
      status: 206,
      headers,
    })
  }
  const stream = Readable.toWeb(
    createReadStream(entry.tempFilePath, {
      start: rangeInfo.start,
      end: rangeInfo.end,
    }),
  ) as unknown as ReadableStream
  return new Response(stream, {
    status: 206,
    headers,
  })
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
