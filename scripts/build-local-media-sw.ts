/**
 * Bundle src/sw/local-media-sw.ts → public/local-media-sw.js.
 * Run from postinstall / prebuild alongside player-lib vendoring.
 *
 * `--verify`: build to a temp file and fail if public/local-media-sw.js
 * differs (CI check for committed artifact drift).
 */
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const entry = join(root, "src", "sw", "local-media-sw.ts")
const outfile = join(root, "public", "local-media-sw.js")
const verify = process.argv.includes("--verify")

if (!existsSync(entry)) {
  if (verify) {
    console.error("[build-local-media-sw] src/sw/local-media-sw.ts missing")
    process.exit(1)
  }
  console.warn("[build-local-media-sw] src/sw/local-media-sw.ts missing; skip")
  process.exit(0)
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function buildTo(target: string): {
  status: number
  stderr: string
  stdout: string
} {
  const result = spawnSync(
    "bun",
    [
      "build",
      entry,
      "--outfile",
      target,
      "--target",
      "browser",
      "--format",
      "iife",
    ],
    { cwd: root, encoding: "utf8", shell: true },
  )
  return {
    status: result.status ?? 1,
    stderr: result.stderr || "",
    stdout: result.stdout || "",
  }
}

if (verify) {
  if (!existsSync(outfile)) {
    console.error(
      "[build-local-media-sw] public/local-media-sw.js missing; run without --verify to build",
    )
    process.exit(1)
  }

  const dir = mkdtempSync(join(tmpdir(), "local-media-sw-"))
  const tempOut = join(dir, "local-media-sw.js")
  try {
    const result = buildTo(tempOut)
    if (result.status !== 0) {
      console.error(result.stderr || result.stdout || "bun build failed")
      process.exit(result.status)
    }

    const rebuilt = sha256File(tempOut)
    const committed = sha256File(outfile)
    if (rebuilt !== committed) {
      console.error(
        "[build-local-media-sw] public/local-media-sw.js is out of sync with src/sw/local-media-sw.ts",
      )
      console.error(`  committed: ${committed}`)
      console.error(`  rebuilt:   ${rebuilt}`)
      console.error(
        "Rebuild and commit: bun scripts/build-local-media-sw.ts && git add public/local-media-sw.js",
      )
      process.exit(1)
    }

    console.info(
      "[build-local-media-sw] public/local-media-sw.js matches source",
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  process.exit(0)
}

const result = buildTo(outfile)

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
