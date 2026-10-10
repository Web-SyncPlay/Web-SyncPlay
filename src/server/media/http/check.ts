/**
 * HTTP façade for POST /api/media/check.
 */

import { detectNativeSupport } from "@/server/media/providers/native-detect"
import { resolveMediaSource } from "@/server/media/resolve"
import {
  clientIpFromRequest,
  consumeRateLimit,
} from "@/server/security/rate-limit"
import { NextResponse } from "next/server"
import { z } from "zod"

function normalizeCheckUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

const checkBodySchema = z.object({
  url: z
    .string()
    .transform(normalizeCheckUrl)
    .pipe(z.url()),
})

function successMessage(input: {
  playbackMode: "direct" | "relay"
  isNativeProvider: boolean
  isLive: boolean | null | undefined
}): string {
  if (input.isNativeProvider) {
    return "Supported natively — ready to sync in a room."
  }
  if (input.playbackMode === "relay") {
    return "Playable via proxy — CORS is handled so rooms can sync it."
  }
  if (input.isLive) {
    return "Live stream detected — playable and syncable."
  }
  return "Playable — ready to sync in a room."
}

export async function handleMediaCheck(request: Request): Promise<Response> {
  const ip = clientIpFromRequest(request)
  const limit = await consumeRateLimit({
    key: `media-check:${ip}`,
    limit: 10,
    windowMs: 60_000,
  })
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many checks. Try again in a minute." },
      { status: 429 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = checkBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Paste a valid http(s) URL." },
      { status: 400 },
    )
  }

  const url = parsed.data.url
  const native = detectNativeSupport(url)
  const resolved = await resolveMediaSource({ url, mintRelay: false })
  const playable = !resolved.failureReason

  if (!playable) {
    return NextResponse.json({
      playable: false,
      url,
      title: resolved.title,
      failureReason: resolved.failureReason,
      message:
        resolved.resolveUserMessage ??
        "This URL could not be resolved for playback.",
    })
  }

  return NextResponse.json({
    playable: true,
    url,
    title: resolved.title,
    playbackMode: resolved.playbackMode,
    durationSeconds: resolved.durationSeconds,
    isLive: resolved.isLive ?? null,
    native: native.isNativeProvider,
    streamCount: resolved.mediaStreams.length,
    message: successMessage({
      playbackMode: resolved.playbackMode,
      isNativeProvider: native.isNativeProvider,
      isLive: resolved.isLive,
    }),
  })
}
