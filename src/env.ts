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

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("production"),
    /** Next.js telemetry; default disabled. */
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
    WS_HEARTBEAT_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(30000)
      .default(5000),
    PROXY_ALLOW_PRIVATE_URLS: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => {
        // Never allow private/LAN proxy targets in production, regardless of input.
        if (process.env.NODE_ENV === "production") return false
        return value === "true"
      }),
    CONTROL_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(60 * 60 * 48)
      .default(60 * 60 * 12),
    /**
     * Retention input for the Valkey yt-dlp extract cache (0–86400).
     * Successful writes use a shorter TTL capped by derived stream-URL max age;
     * this is not always the Redis EX on success.
     */
    YTDLP_CACHE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(0)
      .max(86_400)
      .default(1800),
    /**
     * This replica's reachable base URL for internal local-media range fetch
     * (e.g. http://web:3000). When unset with LOCAL_MEDIA_INTERNAL_SECRET,
     * cross-node HTTP affinity is disabled and Redis pub/sub remains the path.
     */
    INTERNAL_NODE_BASE_URL: z.url().optional(),
    /** Shared secret for /api/media/local/internal/* (min 16 chars when set). */
    LOCAL_MEDIA_INTERNAL_SECRET: z.string().min(16).optional(),
    /**
     * Public hostname or origin (e.g. web-syncplay.de or https://web-syncplay.de).
     * Used for mediasoup ICE announcedAddress, CORS, and CSP.
     */
    PUBLIC_DOMAIN: z.string().min(1).optional(),
    /**
     * Space-separated absolute origins allowed to iframe this app (CSP
     * frame-ancestors), or a single `*`. Unset/empty = no third-party embeds.
     */
    EMBED_FRAME_ANCESTORS: z
      .string()
      .refine(isValidEmbedFrameAncestors, {
        message:
          "EMBED_FRAME_ANCESTORS must be space-separated absolute http(s) origins (no path/query), or a single *",
      })
      .optional(),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {},

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
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
    WS_HEARTBEAT_INTERVAL_MS: process.env.WS_HEARTBEAT_INTERVAL_MS,
    PROXY_ALLOW_PRIVATE_URLS: process.env.PROXY_ALLOW_PRIVATE_URLS,
    CONTROL_TOKEN_TTL_SECONDS: process.env.CONTROL_TOKEN_TTL_SECONDS,
    YTDLP_CACHE_TTL_SECONDS: process.env.YTDLP_CACHE_TTL_SECONDS,
    INTERNAL_NODE_BASE_URL: process.env.INTERNAL_NODE_BASE_URL,
    LOCAL_MEDIA_INTERNAL_SECRET: process.env.LOCAL_MEDIA_INTERNAL_SECRET,
    PUBLIC_DOMAIN: process.env.PUBLIC_DOMAIN,
    EMBED_FRAME_ANCESTORS: process.env.EMBED_FRAME_ANCESTORS,
  },

  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
})
