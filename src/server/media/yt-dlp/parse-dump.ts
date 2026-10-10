import {
  isHttpOrHttpsUrl,
  sanitizeMediaTitle,
} from "@/shared/sanitize-display"
import type {
  YtDlpExtractSuccess,
  YtDlpNormalizedVariant,
  YtDlpStream,
  YtDlpTextTrack,
} from "@/server/media/yt-dlp/types"

type YtDlpDumpJson = {
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

/**
 * Pure parser for yt-dlp `--dump-single-json` stdout.
 * Kept free of I/O so fixtures can cover format selection without spawning.
 */
export function parseYtDlpDumpJson(
  stdout: string,
  stderr = "",
): YtDlpExtractSuccess {
  const parsed = JSON.parse(stdout) as YtDlpDumpJson
  const title =
    typeof parsed.title === "string" && parsed.title.trim()
      ? sanitizeMediaTitle(parsed.title)
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

  if (topLevelManifestUrl && isHttpOrHttpsUrl(topLevelManifestUrl)) {
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
  } else if (typeof parsed.url === "string" && isHttpOrHttpsUrl(parsed.url)) {
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
    if (typeof src !== "string" || !src || !isHttpOrHttpsUrl(src)) {
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
          ? (sanitizeMediaTitle(format.format_note)?.slice(0, 64) ??
            undefined)
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
        if (
          typeof track.url !== "string" ||
          !track.url ||
          !isHttpOrHttpsUrl(track.url)
        ) {
          continue
        }
        const rawLabel =
          typeof track.name === "string" && track.name.trim()
            ? track.name
            : language
        const nextTrack: YtDlpTextTrack = {
          id: `${language}-${textTrackByLanguage.size + 1}`,
          src: track.url,
          label: sanitizeMediaTitle(rawLabel)?.slice(0, 64) ?? language,
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

  return {
    ok: true,
    title,
    durationSeconds,
    isLive,
    streams,
    textTracks,
    videoVariants,
    audioVariants,
    bestPlayableUrl: pickBestPlayableUrl(streams),
    stderr,
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
