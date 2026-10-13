import type { NextConfig } from "next"

// Default for next CLI (dev/build/start); Docker also sets ENV.
process.env.NEXT_TELEMETRY_DISABLED ??= "1"

// Validates env at boot; set SKIP_ENV_VALIDATION=1 to skip (e.g. image build).
import "./src/env"

const config: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  reactCompiler: true,
  // Native C++ worker + ws (webpack emits import("ws"); must resolve at runtime).
  // redis: keep external under webpack so @redis/client is not bundled against
  // a graph that cannot resolve Node's `stream`.
  serverExternalPackages: ["mediasoup", "ws", "redis", "@redis/client"],
  // Bun/Alpine file tracing can omit runtime-external packages from standalone;
  // force-include ws for /api/ws (used by the WebSocket upgrade path).
  outputFileTracingIncludes: {
    "/api/ws": ["./node_modules/ws/**/*"],
  },
  // `dev` and `build` both pass `--webpack` (see package.json): Turbopack
  // fails on @ffmpeg/ffmpeg's `new Worker(new URL(dynamic, import.meta.url))`
  // used by local-media ABR packaging.
}

export default config
