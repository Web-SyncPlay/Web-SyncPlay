/**
 * Copy single-thread ffmpeg.wasm core into public/ for same-origin load.
 * Run from postinstall / before build so Docker/CI get the ~31MB wasm.
 */
import { copyFileSync, mkdirSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const srcDir = join(root, "node_modules", "@ffmpeg", "core", "dist", "umd")
const destDir = join(root, "public", "ffmpeg")

const files = ["ffmpeg-core.js", "ffmpeg-core.wasm"]

if (!existsSync(join(srcDir, "ffmpeg-core.js"))) {
  console.warn(
    "[vendor-ffmpeg-core] @ffmpeg/core not installed; skip (ok if deps not yet installed)",
  )
  process.exit(0)
}

mkdirSync(destDir, { recursive: true })
for (const name of files) {
  copyFileSync(join(srcDir, name), join(destDir, name))
}
console.info(`[vendor-ffmpeg-core] copied ${files.length} files → public/ffmpeg/`)
