import {
  classifyYtDlpStderr,
  type YtDlpFailureClassification,
} from "@/server/media/yt-dlp/classify"
import { runYtDlp } from "@/server/media/yt-dlp/runner"

export type YtDlpMetadata = {
  title: string | null
  durationSeconds: number | null
}

export type YtDlpStream = {
  id: string
  src: string
  type?: string
  protocol?: string
  width?: number
  height?: number
  bitrate?: number
  audioBitrate?: number
  label?: string
  isDefault?: boolean
  vcodec?: string
  acodec?: string
}

export type YtDlpTextTrack = {
  id: string
  src: string
  label: string
  language?: string
  kind?: "captions" | "subtitles"
  type?: string
  isDefault?: boolean
}

export type YtDlpNormalizedVariant = {
  id: string
  kind: "video" | "audio" | "combined"
  src: string
  label?: string
  width?: number
  height?: number
  vcodec?: string
  acodec?: string
  protocol?: string
  tbr?: number
  abr?: number
}

export type YtDlpExtractSuccess = {
  ok: true
  title: string | null
  durationSeconds: number | null
  isLive: boolean | null
  streams: YtDlpStream[]
  textTracks: YtDlpTextTrack[]
  videoVariants: YtDlpNormalizedVariant[]
  audioVariants: YtDlpNormalizedVariant[]
  /** Best single URL for playback (from JSON / default format). */
  bestPlayableUrl: string | null
  stderr: string
}

export type YtDlpExtractFailure = {
  ok: false
  title: null
  durationSeconds: null
  isLive: null
  streams: YtDlpStream[]
  textTracks: YtDlpTextTrack[]
  videoVariants: YtDlpNormalizedVariant[]
  audioVariants: YtDlpNormalizedVariant[]
  bestPlayableUrl: null
  stderr: string
  code: number
  classification: YtDlpFailureClassification
  userMessage: string
}

export type YtDlpExtractResult = YtDlpExtractSuccess | YtDlpExtractFailure

const inflightByUrl = new Map<string, Promise<YtDlpExtractResult>>()

function logHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return "invalid-url"
  }
}

export async function extractInfo(url: string): Promise<YtDlpExtractResult> {
  const inflight = inflightByUrl.get(url)
  if (inflight) {
    return await inflight
  }
  const done = extractInfoUncached(url).finally(() => {
    inflightByUrl.delete(url)
  })
  inflightByUrl.set(url, done)
  return await done
}

async function extractInfoUncached(url: string): Promise<YtDlpExtractResult> {
  const result = await runYtDlp(["--no-playlist", "--dump-single-json", url])
  if (result.code !== 0) {
    const { classification, userMessage } = classifyYtDlpStderr(result.stderr)
    console.warn("[yt-dlp] extract failed", {
      host: logHost(url),
      code: result.code,
      classification,
    })
    return {
      ok: false,
      title: null,
      durationSeconds: null,
      isLive: null,
      streams: [],
      textTracks: [],
      videoVariants: [],
      audioVariants: [],
      bestPlayableUrl: null,
      stderr: result.stderr,
      code: result.code,
      classification,
      userMessage,
    }
  }

  try {
    const parsed = JSON.parse(result.stdout) as {
      title?: unknown
      duration?: unknown
      is_live?: unknown
      live_status?: unknown
      url?: unknown
      manifest_url?: unknown
      protocol?: unknown
      ext?: unknown
      formats?: Array<Record<string, unknown>>
      subtitles?: Record<string, Array<Record<string, unknown>>>
      automatic_captions?: Record<string, Array<Record<string, unknown>>>
    }
    const title =
      typeof parsed.title === "string" && parsed.title.trim()
        ? parsed.title.trim()
        : null
    const durationSeconds =
      typeof parsed.duration === "number" && Number.isFinite(parsed.duration)
        ? Math.max(0, Math.round(parsed.duration))
        : null

    const isLive =
      typeof parsed.is_live === "boolean"
        ? parsed.is_live
        : typeof parsed.live_status === "string" &&
            (parsed.live_status === "is_live" ||
              parsed.live_status === "is_upcoming")
          ? true
          : null

    const streams: YtDlpStream[] = []
    const videoVariants: YtDlpNormalizedVariant[] = []
    const audioVariants: YtDlpNormalizedVariant[] = []
    const seenStreamSrc = new Set<string>()
    const topLevelManifestUrl =
      typeof parsed.manifest_url === "string" ? parsed.manifest_url : null
    const topLevelProtocol =
      typeof parsed.protocol === "string" ? parsed.protocol : undefined

    if (topLevelManifestUrl) {
      const autoStream: YtDlpStream = {
        id: "auto",
        src: topLevelManifestUrl,
        type:
          topLevelProtocol === "m3u8_native"
            ? "application/x-mpegURL"
            : typeof parsed.ext === "string"
              ? `video/${String(parsed.ext)}`
              : undefined,
        protocol: topLevelProtocol,
        isDefault: true,
        label: "Auto",
      }
      streams.push(autoStream)
      seenStreamSrc.add(topLevelManifestUrl)
      pushVariantFromTopLevel(
        topLevelManifestUrl,
        topLevelProtocol,
        videoVariants,
        audioVariants,
        autoStream,
      )
    } else if (typeof parsed.url === "string") {
      const defaultStream: YtDlpStream = {
        id: "default",
        src: parsed.url,
        type:
          typeof parsed.ext === "string"
            ? `video/${String(parsed.ext)}`
            : undefined,
        protocol: topLevelProtocol,
        isDefault: true,
        label: "Default",
      }
      streams.push(defaultStream)
      seenStreamSrc.add(parsed.url)
      pushVariantFromTopLevel(
        parsed.url,
        topLevelProtocol,
        videoVariants,
        audioVariants,
        defaultStream,
      )
    }

    for (const format of parsed.formats ?? []) {
      const src = format.url
      if (typeof src !== "string" || !src) {
        continue
      }
      if (seenStreamSrc.has(src)) {
        continue
      }

      const width =
        typeof format.width === "number" && Number.isFinite(format.width)
          ? format.width
          : undefined
      const height =
        typeof format.height === "number" && Number.isFinite(format.height)
          ? format.height
          : undefined
      const vcodec =
        typeof format.vcodec === "string" ? format.vcodec : undefined
      const acodec =
        typeof format.acodec === "string" ? format.acodec : undefined
      const formatId =
        typeof format.format_id === "string"
          ? format.format_id
          : `${width ?? "x"}-${height ?? "x"}-${streams.length + 1}`
      const hasVideo = Boolean(vcodec && vcodec !== "none")
      const hasAudio = Boolean(acodec && acodec !== "none")
      const streamEntry: YtDlpStream = {
        id: formatId,
        src,
        type:
          typeof format.protocol === "string" &&
          format.protocol === "m3u8_native"
            ? "application/x-mpegURL"
            : typeof format.ext === "string"
              ? `video/${String(format.ext)}`
              : undefined,
        protocol:
          typeof format.protocol === "string" ? format.protocol : undefined,
        width,
        height,
        vcodec,
        acodec,
        bitrate:
          typeof format.tbr === "number" && Number.isFinite(format.tbr)
            ? Math.round(format.tbr * 1000)
            : undefined,
        audioBitrate:
          typeof format.abr === "number" && Number.isFinite(format.abr)
            ? Math.round(format.abr * 1000)
            : undefined,
        label:
          typeof format.format_note === "string"
            ? format.format_note
            : width && height
              ? `${height}p`
              : undefined,
      }
      streams.push(streamEntry)
      seenStreamSrc.add(src)

      const tbr =
        typeof format.tbr === "number" && Number.isFinite(format.tbr)
          ? format.tbr
          : undefined
      const abr =
        typeof format.abr === "number" && Number.isFinite(format.abr)
          ? format.abr
          : undefined
      const protocol =
        typeof format.protocol === "string" ? format.protocol : undefined
      const label = streamEntry.label
      if (hasVideo && hasAudio) {
        const v: YtDlpNormalizedVariant = {
          id: formatId,
          kind: "combined",
          src,
          label,
          width,
          height,
          vcodec,
          acodec,
          protocol,
          tbr,
          abr,
        }
        videoVariants.push(v)
        audioVariants.push({ ...v, kind: "combined" })
      } else if (hasVideo) {
        videoVariants.push({
          id: formatId,
          kind: "video",
          src,
          label,
          width,
          height,
          vcodec,
          acodec,
          protocol,
          tbr,
          abr,
        })
      } else if (hasAudio) {
        audioVariants.push({
          id: formatId,
          kind: "audio",
          src,
          label,
          vcodec,
          acodec,
          protocol,
          tbr,
          abr,
        })
      }
    }

    const textTrackByLanguage = new Map<string, YtDlpTextTrack>()
    const subtitleSources = [parsed.subtitles, parsed.automatic_captions]
    for (const source of subtitleSources) {
      for (const [language, tracks] of Object.entries(source ?? {})) {
        for (const track of tracks) {
          if (typeof track.url !== "string" || !track.url) continue
          const nextTrack: YtDlpTextTrack = {
            id: `${language}-${textTrackByLanguage.size + 1}`,
            src: track.url,
            label:
              typeof track.name === "string" && track.name.trim()
                ? track.name
                : language,
            language,
            kind: "subtitles",
            type:
              typeof track.ext === "string" ? `text/${track.ext}` : "text/vtt",
          }
          const existing = textTrackByLanguage.get(language)
          const nextIsVtt = nextTrack.type === "text/vtt"
          const existingIsVtt = existing?.type === "text/vtt"
          if (!existing || (nextIsVtt && !existingIsVtt)) {
            textTrackByLanguage.set(language, nextTrack)
          }
        }
      }
    }
    const textTracks = Array.from(textTrackByLanguage.values()).map(
      (track, index) => ({
        ...track,
        id: `${track.language ?? "track"}-${index + 1}`,
        isDefault: index === 0,
      }),
    )

    const bestPlayableUrl = pickBestPlayableUrl(streams)

    return {
      ok: true,
      title,
      durationSeconds,
      isLive,
      streams,
      textTracks,
      videoVariants,
      audioVariants,
      bestPlayableUrl,
      stderr: result.stderr,
    }
  } catch {
    console.warn("[yt-dlp] JSON parse failed", { host: logHost(url) })
    return {
      ok: false,
      title: null,
      durationSeconds: null,
      isLive: null,
      streams: [],
      textTracks: [],
      videoVariants: [],
      audioVariants: [],
      bestPlayableUrl: null,
      stderr: result.stderr,
      code: result.code,
      classification: "unknown",
      userMessage: "Could not parse media metadata from yt-dlp.",
    }
  }
}

function pushVariantFromTopLevel(
  src: string,
  protocol: string | undefined,
  videoVariants: YtDlpNormalizedVariant[],
  audioVariants: YtDlpNormalizedVariant[],
  stream: YtDlpStream,
) {
  const label = stream.label
  const v: YtDlpNormalizedVariant = {
    id: "auto",
    kind: "combined",
    src,
    label,
    protocol,
    vcodec: undefined,
    acodec: undefined,
  }
  videoVariants.push(v)
  audioVariants.push({ ...v })
}

function pickBestPlayableUrl(streams: YtDlpStream[]): string | null {
  const defaultStream =
    streams.find((s) => s.isDefault) ?? streams.find((s) => s.id === "default")
  if (defaultStream) return defaultStream.src
  return streams[0]?.src ?? null
}

export async function extractMetadata(url: string): Promise<YtDlpMetadata> {
  const info = await extractInfo(url)
  if (!info.ok) {
    return { title: null, durationSeconds: null }
  }
  return {
    title: info.title,
    durationSeconds: info.durationSeconds,
  }
}
