import { env } from "@/env"
import { matchIdentitySecret } from "@/server/realtime/services/identity-store"
import { createLocalMediaEntry } from "@/server/media/local-media-store"
import {
  clientIpFromRequest,
  consumeRateLimit,
} from "@/server/security/rate-limit"
import { NextResponse } from "next/server"

const ALLOWED_MIME_PREFIXES = ["video/", "audio/"]

export async function POST(request: Request) {
  const ip = clientIpFromRequest(request)
  const limit = consumeRateLimit({
    key: `upload:${ip}`,
    limit: 10,
    windowMs: 60_000,
  })
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many uploads" }, { status: 429 })
  }

  const formData = await request.formData()
  const roomId = String(formData.get("roomId") ?? "").trim()
  const ownerUserId = String(formData.get("ownerUserId") ?? "").trim()
  const userSecret = String(formData.get("userSecret") ?? "").trim()
  const file = formData.get("file")

  if (!roomId || !ownerUserId || !userSecret || !(file instanceof File)) {
    return NextResponse.json(
      { error: "roomId, ownerUserId, userSecret and file are required" },
      { status: 400 },
    )
  }

  const identityOk = await matchIdentitySecret({
    roomId,
    userId: ownerUserId,
    userSecret,
  })
  if (!identityOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const mimeType = file.type || "application/octet-stream"
  if (!ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))) {
    return NextResponse.json(
      { error: "Only video/audio uploads are allowed" },
      { status: 415 },
    )
  }

  if (file.size > env.LOCAL_MEDIA_MAX_BYTES) {
    return NextResponse.json(
      { error: "File exceeds size limit" },
      { status: 413 },
    )
  }

  const buffer = new Uint8Array(await file.arrayBuffer())
  const entry = await createLocalMediaEntry({
    roomId,
    ownerUserId,
    filename: file.name,
    mimeType,
    bytes: buffer,
  })

  return NextResponse.json({
    localMediaId: entry.id,
    name: entry.filename,
    mimeType: entry.mimeType,
    sizeBytes: entry.sizeBytes,
  })
}
