/**
 * Bundle src/sw/local-media-sw.ts → public/local-media-sw.js.
 * Run from postinstall / prebuild alongside player-lib vendoring.
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const entry = join(root, "src", "sw", "local-media-sw.ts")
const outfile = join(root, "public", "local-media-sw.js")

if (!existsSync(entry)) {
  console.warn("[build-local-media-sw] src/sw/local-media-sw.ts missing; skip")
  process.exit(0)
}

const result = spawnSync(
  "bun",
  [
    "build",
    entry,
    "--outfile",
    outfile,
    "--target",
    "browser",
    "--format",
    "iife",
  ],
  { cwd: root, encoding: "utf8", shell: true },
)

if (result.status !== 0) {
  console.error(result.stderr || result.stdout || "bun build failed")
  if (existsSync(outfile)) {
    console.warn(
      "[build-local-media-sw] build failed; keeping existing public/local-media-sw.js",
    )
  } else {
    console.warn(
      "[build-local-media-sw] build failed and no existing public/local-media-sw.js",
    )
  }
  process.exit(0)
}

console.info("[build-local-media-sw] wrote public/local-media-sw.js")
