/** Guess a playable MIME from a filename when the OS leaves `File.type` empty. */
const EXTENSION_MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  ogg: "video/ogg",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  flac: "audio/flac",
  opus: "audio/opus",
}

export function guessMimeTypeFromFilename(filename: string): string | null {
  const base = filename.split(/[\\/]/).pop() ?? filename
  const dot = base.lastIndexOf(".")
  if (dot < 0 || dot === base.length - 1) return null
  const ext = base.slice(dot + 1).toLowerCase()
  return EXTENSION_MIME[ext] ?? null
}

export function resolvePlayableMimeType(
  fileType: string | undefined | null,
  filename: string,
): string | null {
  const fromFile = (fileType ?? "").trim().toLowerCase()
  if (fromFile.startsWith("video/") || fromFile.startsWith("audio/")) {
    return fromFile
  }
  const guessed = guessMimeTypeFromFilename(filename)
  if (guessed) return guessed
  return null
}

export function isProgressiveMediaMime(mime: string | undefined | null): boolean {
  if (!mime) return false
  const lower = mime.toLowerCase()
  return lower.startsWith("video/") || lower.startsWith("audio/")
}
