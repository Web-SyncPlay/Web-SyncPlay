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
  serverExternalPackages: ["mediasoup", "ws"],
  // Bun/Alpine file tracing can omit runtime-external packages from standalone;
  // force-include ws for /api/ws (used by the WebSocket upgrade path).
  outputFileTracingIncludes: {
    "/api/ws": ["./node_modules/ws/**/*"],
  },
  // Production builds use `next build --webpack` (see package.json): Turbopack
  // fails on @ffmpeg/ffmpeg's `new Worker(new URL(dynamic, import.meta.url))`
  // used by local-media ABR packaging.
  experimental: {
    turbopackFileSystemCacheForDev: true,
  },
}

export default config
