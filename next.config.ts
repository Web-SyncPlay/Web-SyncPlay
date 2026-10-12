import type { NextConfig } from "next"

// Default for next CLI (dev/build/start); Docker also sets ENV.
process.env.NEXT_TELEMETRY_DISABLED ??= "1"

// Validates env at boot; set SKIP_ENV_VALIDATION=1 to skip (e.g. image build).
import "./src/env"

const config: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  reactCompiler: true,
  // Native C++ worker — keep out of the webpack/turbopack bundle.
  serverExternalPackages: ["mediasoup"],
  // Production builds use `next build --webpack` (see package.json): Turbopack
  // fails on @ffmpeg/ffmpeg's `new Worker(new URL(dynamic, import.meta.url))`
  // used by local-media ABR packaging.
  experimental: {
    turbopackFileSystemCacheForDev: true,
  },
}

export default config
