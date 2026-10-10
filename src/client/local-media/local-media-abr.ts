/**
 * Provider-side ABR packaging for local media (Elevate B).
 * Uses single-thread ffmpeg.wasm loaded from /vendor (vendored core).
 */

import { registerLocalMediaFile } from "@/client/local-media/local-media-provider"
import type { TypedRoomEventSender } from "@/contracts/room-events"

const MIN_BYTES = 1 * 1024 * 1024
const MAX_BYTES = 200 * 1024 * 1024
const LADDER_HEIGHTS = [720, 480] as const

export type AbrVariantMeta = {
  localMediaId: string
  height: number
  bandwidth: number
  label: string
  mimeType: string
  sizeBytes: number
  name: string
}

/** Viewer-side metadata for SW range responses (child ids). */
const abrMetaById = new Map<
  string,
  { mimeType: string; sizeBytes: number; parentLocalMediaId: string }
>()

export function rememberAbrVariantMeta(
  localMediaId: string,
  meta: { mimeType: string; sizeBytes: number; parentLocalMediaId: string },
) {
  abrMetaById.set(localMediaId, meta)
}

export function getAbrVariantMeta(localMediaId: string) {
  return abrMetaById.get(localMediaId) ?? null
}

export function shouldPackageLocalMediaAbr(
  file: File,
  mimeType: string,
): boolean {
  if (typeof window === "undefined") return false
  if (!mimeType.toLowerCase().startsWith("video/")) return false
  if (file.size < MIN_BYTES || file.size > MAX_BYTES) return false
  return true
}

type ProbeResult = {
  width: number
  height: number
  durationSec: number
}

/**
 * Quick metadata probe for duration (and optionally dimensions).
 * Safe to call before playlist:add:local so control UI has a catalog length.
 */
export async function probeLocalMediaDurationSec(
  file: File,
): Promise<number | null> {
  const probe = await probeVideoFile(file)
  return probe?.durationSec ?? null
}

function probeVideoFile(file: File): Promise<ProbeResult | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video")
    video.preload = "metadata"
    video.muted = true
    const done = (result: ProbeResult | null) => {
      video.srcObject = null
      video.load()
      resolve(result)
    }
    video.onloadedmetadata = () => {
      const height = video.videoHeight
      const width = video.videoWidth
      const durationSec = video.duration
      if (
        !Number.isFinite(height) ||
        height <= 0 ||
        !Number.isFinite(width) ||
        width <= 0 ||
        !Number.isFinite(durationSec) ||
        durationSec <= 0
      ) {
        done(null)
        return
      }
      done({ width, height, durationSec })
    }
    video.onerror = () => done(null)
    // Prefer srcObject over blob: URL assignment so DOM text is never
    // reinterpreted as a media URL (CodeQL js/xss-through-dom).
    video.srcObject = file
  })
}

function estimateBandwidth(height: number, sizeBytes: number, durationSec: number) {
  if (durationSec > 0 && sizeBytes > 0) {
    const fromSize = Math.round((sizeBytes * 8) / durationSec)
    if (fromSize > 0) return fromSize
  }
  // Rough ladder defaults when size-based estimate is unavailable.
  if (height >= 1080) return 5_000_000
  if (height >= 720) return 2_500_000
  if (height >= 480) return 1_200_000
  return 800_000
}

type Packaged = {
  durationSec: number
  sourceHeight: number
  lowers: Array<{ height: number; file: File; bandwidth: number; label: string }>
}

let ffmpegQueue: Promise<unknown> = Promise.resolve()

function enqueueFfmpeg<T>(task: () => Promise<T>): Promise<T> {
  const next = ffmpegQueue.then(task, task)
  ffmpegQueue = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

async function packageLowers(
  file: File,
  sourceHeight: number,
  durationSec: number,
): Promise<Packaged["lowers"]> {
  const targets = LADDER_HEIGHTS.filter((h) => sourceHeight > h)
  if (targets.length === 0) return []

  const { FFmpeg } = await import("@ffmpeg/ffmpeg")
  const { fetchFile } = await import("@ffmpeg/util")
  const ffmpeg = new FFmpeg()
  await ffmpeg.load({
    coreURL: "/vendor/ffmpeg-core.js",
    wasmURL: "/vendor/ffmpeg-core.wasm",
  })

  const inputName = "input.bin"
  await ffmpeg.writeFile(inputName, await fetchFile(file))

  const lowers: Packaged["lowers"] = []
  try {
    for (const height of targets) {
      const outName = `out-${height}.mp4`
      const code = await ffmpeg.exec([
        "-i",
        inputName,
        "-vf",
        `scale=-2:${height}`,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "28",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        outName,
      ])
      if (code !== 0) {
        console.warn("[local-media-abr] ffmpeg exited", code, "for", height)
        continue
      }
      const data = await ffmpeg.readFile(outName)
      if (typeof data === "string") continue
      const bytes =
        data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer)
      const copy = new Uint8Array(bytes.byteLength)
      copy.set(bytes)
      const outFile = new File([copy], `${height}p.mp4`, { type: "video/mp4" })
      lowers.push({
        height,
        file: outFile,
        bandwidth: estimateBandwidth(height, outFile.size, durationSec),
        label: `${height}p`,
      })
      try {
        await ffmpeg.deleteFile(outName)
      } catch {
        // ignore
      }
    }
  } finally {
    try {
      await ffmpeg.deleteFile(inputName)
    } catch {
      // ignore
    }
    try {
      ffmpeg.terminate()
    } catch {
      // ignore
    }
  }

  return lowers
}

export async function packageLocalMediaAbr(
  file: File,
): Promise<Packaged | null> {
  if (typeof window === "undefined") return null
  const probe = await probeVideoFile(file)
  if (!probe) return null

  const lowers = await enqueueFfmpeg(() =>
    packageLowers(file, probe.height, probe.durationSec),
  )
  if (lowers.length === 0) return null

  return {
    durationSec: probe.durationSec,
    sourceHeight: probe.height,
    lowers,
  }
}

/**
 * Background: package lowers, register child Files, publish ABR catalog.
 * No-ops quietly when ineligible or packaging fails.
 */
export async function runLocalMediaAbrPublish(input: {
  parentLocalMediaId: string
  file: File
  mimeType: string
  name: string
  send: TypedRoomEventSender
}): Promise<boolean> {
  const { parentLocalMediaId, file, mimeType, name, send } = input
  if (!shouldPackageLocalMediaAbr(file, mimeType)) return false

  try {
    const packaged = await packageLocalMediaAbr(file)
    if (!packaged) return false

    const sourceBandwidth = estimateBandwidth(
      packaged.sourceHeight,
      file.size,
      packaged.durationSec,
    )

    rememberAbrVariantMeta(parentLocalMediaId, {
      mimeType,
      sizeBytes: file.size,
      parentLocalMediaId,
    })

    const variants: AbrVariantMeta[] = [
      {
        localMediaId: parentLocalMediaId,
        height: packaged.sourceHeight,
        bandwidth: sourceBandwidth,
        label:
          packaged.sourceHeight >= 100
            ? `${packaged.sourceHeight}p`
            : "Source",
        mimeType,
        sizeBytes: file.size,
        name,
      },
    ]

    for (const lower of packaged.lowers) {
      const childId = crypto.randomUUID()
      registerLocalMediaFile(childId, lower.file, "video/mp4")
      rememberAbrVariantMeta(childId, {
        mimeType: "video/mp4",
        sizeBytes: lower.file.size,
        parentLocalMediaId,
      })
      send("local-media:ready", { localMediaId: childId, ready: true })
      variants.push({
        localMediaId: childId,
        height: lower.height,
        bandwidth: lower.bandwidth,
        label: lower.label,
        mimeType: "video/mp4",
        sizeBytes: lower.file.size,
        name: `${name} (${lower.label})`,
      })
    }

    send("local-media:abr:publish", {
      parentLocalMediaId,
      durationSec: packaged.durationSec,
      variants,
    })
    return true
  } catch (error) {
    console.warn("[local-media-abr] packaging failed", error)
    return false
  }
}
