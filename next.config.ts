import type { NextConfig } from "next"

// Default on for all next CLI paths (dev/build/start); Docker also sets this via ENV.
process.env.NEXT_TELEMETRY_DISABLED ??= "1"

/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env"

const config: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  reactCompiler: true,
  // Native C++ worker — keep out of the webpack/turbopack bundle.
  serverExternalPackages: ["mediasoup"],
  experimental: {
    turbopackFileSystemCacheForDev: true,
  },
}

export default config
