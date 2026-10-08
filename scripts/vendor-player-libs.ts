/**
 * Copy hls.js / dash.js / ffmpeg.wasm UMD builds into public/vendor for
 * same-origin load. Run from postinstall / before build (Docker skips
 * postinstall scripts).
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const destDir = join(root, "public", "vendor")

const copies = [
  {
    from: join(root, "node_modules", "hls.js", "dist", "hls.min.js"),
    to: join(destDir, "hls.min.js"),
    label: "hls.js",
  },
  {
    from: join(root, "node_modules", "dashjs", "dist", "dash.all.min.js"),
    to: join(destDir, "dash.all.min.js"),
    label: "dashjs",
  },
  {
    from: join(
      root,
      "node_modules",
      "@ffmpeg",
      "core",
      "dist",
      "umd",
      "ffmpeg-core.js",
    ),
    to: join(destDir, "ffmpeg-core.js"),
    label: "@ffmpeg/core js",
  },
  {
    from: join(
      root,
      "node_modules",
      "@ffmpeg",
      "core",
      "dist",
      "umd",
      "ffmpeg-core.wasm",
    ),
    to: join(destDir, "ffmpeg-core.wasm"),
    label: "@ffmpeg/core wasm",
  },
] as const

let missing = false
for (const { from, label } of copies) {
  if (!existsSync(from)) {
    console.warn(
      `[vendor-player-libs] ${label} not installed (${from}); skip (ok if deps not yet installed)`,
    )
    missing = true
  }
}
if (missing) {
  process.exit(0)
}

mkdirSync(destDir, { recursive: true })
for (const { from, to } of copies) {
  copyFileSync(from, to)
}
console.info(
  `[vendor-player-libs] copied ${copies.length} files → public/vendor/`,
)
