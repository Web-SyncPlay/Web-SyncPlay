/**
 * Client-only playability probe for the landing “Will it play?” local-file mode.
 * Does not upload bytes; result is for *this* browser only.
 */

import { canUseFileSystemAccess } from "@/client/local-media/local-media-handles"
import { attachLocalMediaFileForProbe } from "@/client/local-media/local-media-probe-attach"
import { resolvePlayableMimeType } from "@/shared/media-mime"

export type LocalPlayabilityResult =
  | {
      playable: true
      fileName: string
      sizeBytes: number
      mimeType: string
      kind: "video" | "audio"
      durationSeconds: number | null
      fsaAvailable: boolean
      swAvailable: boolean
      message: string
    }
  | {
      playable: false
      fileName: string
      sizeBytes: number
      failureReason: "unsupported_type" | "empty" | "decode_failed"
      message: string
      fsaAvailable: boolean
      swAvailable: boolean
    }

function capabilityFlags(): { fsaAvailable: boolean; swAvailable: boolean } {
  const fsaAvailable =
    typeof window !== "undefined" ? canUseFileSystemAccess() : false
  const swAvailable =
    typeof navigator !== "undefined" && "serviceWorker" in navigator
  return { fsaAvailable, swAvailable }
}

const PROBE_TIMEOUT_MS = 30_000

function probeMediaDurationSec(
  file: File,
  mimeType: string,
): Promise<number | null> {
  return new Promise((resolve) => {
    const isAudio = mimeType.startsWith("audio/")
    const el = document.createElement(isAudio ? "audio" : "video")
    el.preload = "metadata"
    if (!isAudio) {
      ;(el as HTMLVideoElement).muted = true
    }
    const detach = attachLocalMediaFileForProbe(el, file)
    let settled = false
    const done = (durationSec: number | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeoutId)
      el.onloadedmetadata = null
      el.onerror = null
      detach()
      resolve(durationSec)
    }
    const timeoutId = window.setTimeout(() => done(null), PROBE_TIMEOUT_MS)
    el.onloadedmetadata = () => {
      const durationSec = el.duration
      if (!Number.isFinite(durationSec) || durationSec <= 0) {
        done(null)
        return
      }
      done(durationSec)
    }
    el.onerror = () => done(null)
  })
}

export async function probeLocalFilePlayability(
  file: File,
): Promise<LocalPlayabilityResult> {
  const caps = capabilityFlags()
  const fileName = file.name || "Local media"
  const sizeBytes = file.size

  if (sizeBytes <= 0) {
    return {
      playable: false,
      fileName,
      sizeBytes,
      failureReason: "empty",
      message: "File is empty.",
      ...caps,
    }
  }

  const mimeType = resolvePlayableMimeType(file.type, file.name)
  if (!mimeType) {
    return {
      playable: false,
      fileName,
      sizeBytes,
      failureReason: "unsupported_type",
      message: "Only video or audio files can be shared in a room.",
      ...caps,
    }
  }

  const durationSeconds = await probeMediaDurationSec(file, mimeType)
  if (durationSeconds === null) {
    return {
      playable: false,
      fileName,
      sizeBytes,
      failureReason: "decode_failed",
      message:
        "Won’t play in this browser. Try a different format (e.g. MP4/H.264).",
      ...caps,
    }
  }

  const kind: "video" | "audio" = mimeType.startsWith("audio/")
    ? "audio"
    : "video"

  return {
    playable: true,
    fileName,
    sizeBytes,
    mimeType,
    kind,
    durationSeconds,
    ...caps,
    message:
      "Plays in this browser. In a room, friends stream from your tab while you stay online.",
  }
}

export function formatFileSizeBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—"
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
