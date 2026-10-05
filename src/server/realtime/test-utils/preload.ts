/**
 * Preload for bun test: allow importing modules that touch `@/env`
 * without a live Valkey URL.
 */
process.env.SKIP_ENV_VALIDATION ??= "1"
process.env.VALKEY_URL ??= "redis://127.0.0.1:6379"
if (!process.env.NODE_ENV) {
  ;(process.env as { NODE_ENV?: string }).NODE_ENV = "test"
}
