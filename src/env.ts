import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

/** Absolute http(s) origin, or bare `*` (must be the sole token). */
function isValidEmbedFrameAncestorToken(token: string): boolean {
  if (token === "*") return true
  try {
    const url = new URL(token)
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
    if (url.username || url.password) return false
    if (url.search || url.hash) return false
    if (url.pathname !== "/" && url.pathname !== "") return false
    return token.replace(/\/$/, "") === url.origin
  } catch {
    return false
  }
}

function isValidEmbedFrameAncestors(raw: string): boolean {
  const parts = raw.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return true
  if (parts.includes("*")) {
    return parts.length === 1 && parts[0] === "*"
  }
  return parts.every(isValidEmbedFrameAncestorToken)
}

/** Schema error when only one of the multi-replica local-media pair is set. */
export const LOCAL_MEDIA_INTERNAL_PAIR_MESSAGE =
  "INTERNAL_NODE_BASE_URL and LOCAL_MEDIA_INTERNAL_SECRET must both be set or both be unset"

/** Both unset or both set; exactly one set is invalid. */
export function refineLocalMediaInternalEnvPair(
  data: {
    INTERNAL_NODE_BASE_URL?: string
    LOCAL_MEDIA_INTERNAL_SECRET?: string
  },
  ctx: z.RefinementCtx,
): void {
  const hasBase = data.INTERNAL_NODE_BASE_URL !== undefined
  const hasSecret = data.LOCAL_MEDIA_INTERNAL_SECRET !== undefined
  if (hasBase === hasSecret) return
  ctx.addIssue({
    code: "custom",
    message: LOCAL_MEDIA_INTERNAL_PAIR_MESSAGE,
    path: hasBase
      ? ["LOCAL_MEDIA_INTERNAL_SECRET"]
      : ["INTERNAL_NODE_BASE_URL"],
  })
}

export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("production"),
    NEXT_TELEMETRY_DISABLED: z
      .enum(["0", "1"])
      .default("1")
      .transform((value) => value === "1"),
    VALKEY_URL: z.url(),
    YTDLP_BIN: z.string().default("yt-dlp"),
    YTDLP_MAX_CONCURRENT: z.coerce.number().int().min(1).default(2),
    YTDLP_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(120_000)
      .default(30_000),
    FALLBACK_DEFAULT_MEDIA_URL: z.url().default("https://youtu.be/uD4izuDMUQA"),
    ROOM_PARTICIPANTS_LIMIT: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(100),
    ROOM_ACTION_LOG_LIMIT: z.coerce
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(500),
    ROOM_PLAYLIST_LIMIT: z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .default(50),
    PROXY_ALLOW_PRIVATE_URLS: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => {
        // Forced false in production regardless of input.
        if (process.env.NODE_ENV === "production") return false
        return value === "true"
      }),
    /** Per-replica base URL for internal local-media range fetch; pair with LOCAL_MEDIA_INTERNAL_SECRET. */
    INTERNAL_NODE_BASE_URL: z.url().optional(),
    /** Shared secret for /api/media/local/internal/* (≥16 chars when set). */
    LOCAL_MEDIA_INTERNAL_SECRET: z.string().min(16).optional(),
    /**
     * Public hostname/origin for ICE announcedAddress, CORS, CSP.
     * Edge reads the same key via raw `process.env` in `src/shared/public-domain.ts`
     * (cannot import this full schema).
     */
    PUBLIC_DOMAIN: z.string().min(1).optional(),
    /**
     * CSP frame-ancestors allowlist (space-separated origins or `*`).
     * Edge mirrors via raw `process.env` in `src/shared/public-domain.ts`.
     */
    EMBED_FRAME_ANCESTORS: z
      .string()
      .refine(isValidEmbedFrameAncestors, {
        message:
          "EMBED_FRAME_ANCESTORS must be space-separated absolute http(s) origins (no path/query), or a single *",
      })
      .optional(),
  },

  client: {},

  // Must list keys explicitly — edge/client cannot destruct `process.env`.
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED,
    VALKEY_URL: process.env.VALKEY_URL,
    YTDLP_BIN: process.env.YTDLP_BIN,
    YTDLP_MAX_CONCURRENT: process.env.YTDLP_MAX_CONCURRENT,
    YTDLP_TIMEOUT_MS: process.env.YTDLP_TIMEOUT_MS,
    FALLBACK_DEFAULT_MEDIA_URL: process.env.FALLBACK_DEFAULT_MEDIA_URL,
    ROOM_PARTICIPANTS_LIMIT: process.env.ROOM_PARTICIPANTS_LIMIT,
    ROOM_ACTION_LOG_LIMIT: process.env.ROOM_ACTION_LOG_LIMIT,
    ROOM_PLAYLIST_LIMIT: process.env.ROOM_PLAYLIST_LIMIT,
    PROXY_ALLOW_PRIVATE_URLS: process.env.PROXY_ALLOW_PRIVATE_URLS,
    INTERNAL_NODE_BASE_URL: process.env.INTERNAL_NODE_BASE_URL,
    LOCAL_MEDIA_INTERNAL_SECRET: process.env.LOCAL_MEDIA_INTERNAL_SECRET,
    PUBLIC_DOMAIN: process.env.PUBLIC_DOMAIN,
    EMBED_FRAME_ANCESTORS: process.env.EMBED_FRAME_ANCESTORS,
  },

  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
  createFinalSchema: (shape) =>
    z.object(shape).superRefine(refineLocalMediaInternalEnvPair),
})
