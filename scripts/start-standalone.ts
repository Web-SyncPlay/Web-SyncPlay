/**
 * Production start for `output: "standalone"` (same layout as the Docker runner).
 * Syncs `.next/static` + `public` into `.next/standalone`, then runs `node server.js`.
 */
import { spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const root = process.cwd()
const standaloneDir = join(root, ".next", "standalone")
const serverJs = join(standaloneDir, "server.js")

if (!existsSync(serverJs)) {
  console.error(
    "Missing .next/standalone/server.js — run `bun run build` first.",
  )
  process.exit(1)
}

const staticSrc = join(root, ".next", "static")
const staticDst = join(standaloneDir, ".next", "static")
const publicSrc = join(root, "public")
const publicDst = join(standaloneDir, "public")

if (existsSync(staticSrc)) {
  mkdirSync(join(standaloneDir, ".next"), { recursive: true })
  cpSync(staticSrc, staticDst, { recursive: true })
}

if (existsSync(publicSrc)) {
  cpSync(publicSrc, publicDst, { recursive: true })
}

process.env.NEXT_TELEMETRY_DISABLED ??= "1"

// Use Node (not Bun) — matches the Docker runner and mediasoup's native worker.
const child = spawn("node", ["server.js"], {
  cwd: standaloneDir,
  stdio: "inherit",
  env: process.env,
})

const forward = (signal: NodeJS.Signals) => {
  if (!child.killed) {
    child.kill(signal)
  }
}

process.on("SIGINT", () => forward("SIGINT"))
process.on("SIGTERM", () => forward("SIGTERM"))

child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(1)
  }
  process.exit(code ?? 1)
})
