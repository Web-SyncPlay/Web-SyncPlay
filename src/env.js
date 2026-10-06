import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("production"),
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
    ROOM_HISTORY_LIMIT: z.coerce.number().int().min(1).max(200).default(100),
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
    OPS_SECRET: z.string().min(8).optional(),
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
    YTDLP_CACHE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(0)
      .max(86_400)
      .default(1800),
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
    VALKEY_URL: process.env.VALKEY_URL,
    YTDLP_BIN: process.env.YTDLP_BIN,
    YTDLP_MAX_CONCURRENT: process.env.YTDLP_MAX_CONCURRENT,
    YTDLP_TIMEOUT_MS: process.env.YTDLP_TIMEOUT_MS,
    FALLBACK_DEFAULT_MEDIA_URL: process.env.FALLBACK_DEFAULT_MEDIA_URL,
    ROOM_PARTICIPANTS_LIMIT: process.env.ROOM_PARTICIPANTS_LIMIT,
    ROOM_HISTORY_LIMIT: process.env.ROOM_HISTORY_LIMIT,
    ROOM_ACTION_LOG_LIMIT: process.env.ROOM_ACTION_LOG_LIMIT,
    ROOM_PLAYLIST_LIMIT: process.env.ROOM_PLAYLIST_LIMIT,
    WS_HEARTBEAT_INTERVAL_MS: process.env.WS_HEARTBEAT_INTERVAL_MS,
    OPS_SECRET: process.env.OPS_SECRET,
    PROXY_ALLOW_PRIVATE_URLS: process.env.PROXY_ALLOW_PRIVATE_URLS,
    CONTROL_TOKEN_TTL_SECONDS: process.env.CONTROL_TOKEN_TTL_SECONDS,
    YTDLP_CACHE_TTL_SECONDS: process.env.YTDLP_CACHE_TTL_SECONDS,
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
