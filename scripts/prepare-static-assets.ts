/**
 * Vendors player assets and builds the local-media service worker.
 * Used by postinstall / prebuild (Docker skips lifecycle scripts).
 */
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const steps = ["vendor-player-libs.ts", "build-local-media-sw.ts"] as const

for (const step of steps) {
  const result = spawnSync("bun", [join("scripts", step)], {
    cwd: root,
    encoding: "utf8",
    shell: true,
    stdio: "inherit",
  })
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1)
  }
}
