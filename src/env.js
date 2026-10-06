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
    WS_HEARTBEAT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(60000)
      .default(15000),
    OPS_SECRET: z.string().min(8).optional(),
    PROXY_ALLOW_PRIVATE_URLS: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    CONTROL_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(60 * 60 * 48)
      .default(60 * 60 * 12),
    LOCAL_MEDIA_RELAY_CHUNK_BYTES: z.coerce
      .number()
      .int()
      .min(16 * 1024)
      .max(1024 * 1024)
      .default(256 * 1024),
    LOCAL_MEDIA_RELAY_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(60_000)
      .default(15_000),
    /** How long aligned provider blocks stay in the process-local fan-out cache (0 disables). */
    LOCAL_MEDIA_BLOCK_CACHE_TTL_MS: z.coerce
      .number()
      .int()
      .min(0)
      .max(600_000)
      .default(120_000),
    /** Soft memory budget for cached local-media blocks (default 64 MiB). */
    LOCAL_MEDIA_BLOCK_CACHE_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(0)
      .max(1024 * 1024 * 1024)
      .default(64 * 1024 * 1024),
    YTDLP_CACHE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(0)
      .max(86_400)
      .default(1800),
    HLS_REWRITE_CACHE_TTL_MS: z.coerce
      .number()
      .int()
      .min(0)
      .max(120_000)
      .default(15_000),
    PRESENCE_BATCH_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(50)
      .max(5_000)
      .default(250),
    SNAPSHOT_COALESCE_MS: z.coerce
      .number()
      .int()
      .min(20)
      .max(2_000)
      .default(100),
    ACTION_LOG_SNAPSHOT_MAX_MS: z.coerce
      .number()
      .int()
      .min(200)
      .max(10_000)
      .default(2_000),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    NEXT_PUBLIC_APP_NAME: z.string().default("Web-SyncPlay"),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
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
    WS_HEARTBEAT_TIMEOUT_MS: process.env.WS_HEARTBEAT_TIMEOUT_MS,
    OPS_SECRET: process.env.OPS_SECRET,
    PROXY_ALLOW_PRIVATE_URLS: process.env.PROXY_ALLOW_PRIVATE_URLS,
    CONTROL_TOKEN_TTL_SECONDS: process.env.CONTROL_TOKEN_TTL_SECONDS,
    LOCAL_MEDIA_RELAY_CHUNK_BYTES: process.env.LOCAL_MEDIA_RELAY_CHUNK_BYTES,
    LOCAL_MEDIA_RELAY_TIMEOUT_MS: process.env.LOCAL_MEDIA_RELAY_TIMEOUT_MS,
    LOCAL_MEDIA_BLOCK_CACHE_TTL_MS: process.env.LOCAL_MEDIA_BLOCK_CACHE_TTL_MS,
    LOCAL_MEDIA_BLOCK_CACHE_MAX_BYTES:
      process.env.LOCAL_MEDIA_BLOCK_CACHE_MAX_BYTES,
    YTDLP_CACHE_TTL_SECONDS: process.env.YTDLP_CACHE_TTL_SECONDS,
    HLS_REWRITE_CACHE_TTL_MS: process.env.HLS_REWRITE_CACHE_TTL_MS,
    PRESENCE_BATCH_INTERVAL_MS: process.env.PRESENCE_BATCH_INTERVAL_MS,
    SNAPSHOT_COALESCE_MS: process.env.SNAPSHOT_COALESCE_MS,
    ACTION_LOG_SNAPSHOT_MAX_MS: process.env.ACTION_LOG_SNAPSHOT_MAX_MS,
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
