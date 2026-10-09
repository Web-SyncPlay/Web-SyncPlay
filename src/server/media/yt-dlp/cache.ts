import { env } from "@/env"
import { sha256HexUrl } from "@/server/media/url-hash"
import { recordYtDlpMetric } from "@/server/media/yt-dlp/metrics"
import { derivedStreamUrlMaxAgeSeconds } from "@/server/media/yt-dlp/policy"
import type { YtDlpExtractResult } from "@/server/media/yt-dlp/types"
import { getCommandClient } from "@/server/redis/client"
import { keys } from "@/server/redis/keys"
import { z } from "zod"

const CACHE_VERSION = 1 as const

const streamSchema = z.object({
  id: z.string(),
  src: z.string(),
  type: z.string().optional(),
  protocol: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  bitrate: z.number().optional(),
  audioBitrate: z.number().optional(),
  label: z.string().optional(),
  isDefault: z.boolean().optional(),
  vcodec: z.string().optional(),
  acodec: z.string().optional(),
})

const textTrackSchema = z.object({
  id: z.string(),
  src: z.string(),
  label: z.string(),
  language: z.string().optional(),
  kind: z.enum(["captions", "subtitles"]).optional(),
  type: z.string().optional(),
  isDefault: z.boolean().optional(),
})

const variantSchema = z.object({
  id: z.string(),
  kind: z.enum(["video", "audio", "combined"]),
  src: z.string(),
  label: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  vcodec: z.string().optional(),
  acodec: z.string().optional(),
  protocol: z.string().optional(),
  tbr: z.number().optional(),
  abr: z.number().optional(),
})

const extractResultSchema: z.ZodType<YtDlpExtractResult> = z.union([
  z.object({
    ok: z.literal(true),
    title: z.string().nullable(),
    durationSeconds: z.number().nullable(),
    isLive: z.boolean().nullable(),
    streams: z.array(streamSchema),
    textTracks: z.array(textTrackSchema),
    videoVariants: z.array(variantSchema),
    audioVariants: z.array(variantSchema),
    bestPlayableUrl: z.string().nullable(),
    stderr: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    title: z.null(),
    durationSeconds: z.null(),
    isLive: z.null(),
    streams: z.array(streamSchema),
    textTracks: z.array(textTrackSchema),
    videoVariants: z.array(variantSchema),
    audioVariants: z.array(variantSchema),
    bestPlayableUrl: z.null(),
    stderr: z.string(),
    code: z.number(),
    classification: z.enum([
      "not_live",
      "not_found",
      "login_required",
      "network",
      "timeout",
      "binary_missing",
      "unknown",
    ]),
    userMessage: z.string(),
  }),
])

const envelopeSchema = z.object({
  v: z.literal(CACHE_VERSION),
  extractedAt: z.number().int().nonnegative(),
  result: extractResultSchema,
})

export type YtDlpCacheEnvelope = z.infer<typeof envelopeSchema>

export const urlHash = sha256HexUrl

/** Operator retention input (`YTDLP_CACHE_TTL_SECONDS`); success writes use a shorter derived TTL. */
function cacheTtlSeconds(): number {
  const raw = env.YTDLP_CACHE_TTL_SECONDS
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 1800
}

export function parseCachedExtract(raw: string): YtDlpExtractResult | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  const envelope = envelopeSchema.safeParse(parsed)
  if (envelope.success) {
    return freshnessFilter(envelope.data)
  }

  return null
}

function freshnessFilter(envelope: YtDlpCacheEnvelope): YtDlpExtractResult | null {
  const { result, extractedAt } = envelope
  if (!result.ok) return result

  const maxAgeSeconds = derivedStreamUrlMaxAgeSeconds(cacheTtlSeconds())
  if (maxAgeSeconds <= 0) return result

  const ageSeconds = Math.max(0, (Date.now() - extractedAt) / 1000)
  if (ageSeconds > maxAgeSeconds) {
    recordYtDlpMetric("cacheStale")
    return null
  }
  return result
}

export async function readExtractCache(
  url: string,
): Promise<YtDlpExtractResult | null> {
  if (cacheTtlSeconds() <= 0) return null
  try {
    const client = await getCommandClient()
    const raw = await client.get(keys.mediaYtDlpExtract(urlHash(url)))
    if (!raw) {
      recordYtDlpMetric("cacheMiss")
      return null
    }
    const parsed = parseCachedExtract(raw)
    if (parsed) {
      recordYtDlpMetric("cacheHit")
      return parsed
    }
    recordYtDlpMetric("cacheMiss")
    return null
  } catch {
    recordYtDlpMetric("cacheMiss")
    return null
  }
}

export async function writeExtractCache(url: string, result: YtDlpExtractResult) {
  const configuredTtl = cacheTtlSeconds()
  if (configuredTtl <= 0) return
  // YTDLP_CACHE_TTL_SECONDS is retention input; success EX is capped by
  // derived stream-URL max age. Failures stay short-lived.
  const ttl = result.ok
    ? derivedStreamUrlMaxAgeSeconds(configuredTtl)
    : 60
  if (ttl <= 0) return
  const envelope: YtDlpCacheEnvelope = {
    v: CACHE_VERSION,
    extractedAt: Date.now(),
    result,
  }
  try {
    const client = await getCommandClient()
    await client.set(
      keys.mediaYtDlpExtract(urlHash(url)),
      JSON.stringify(envelope),
      { EX: ttl },
    )
  } catch {
    // Cache is best-effort.
  }
}

export async function invalidateYtDlpExtractCache(url: string) {
  try {
    const client = await getCommandClient()
    await client.del([keys.mediaYtDlpExtract(urlHash(url))])
  } catch {
    // ignore
  }
}
