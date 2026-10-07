import { isHttpOrHttpsUrl } from "@/lib/sanitize-display"
import {
  MEDIA_STREAM_CATALOG_LIMIT,
  MEDIA_TEXT_TRACK_CATALOG_LIMIT,
  type PlaylistMediaStream,
  type PlaylistTextTrack,
} from "@/zod/types"
import type { YtDlpNormalizedVariant, YtDlpStream, YtDlpTextTrack } from "@/server/media/yt-dlp"
import { PLAYBACK_LADDER_HEIGHTS } from "@/server/media/yt-dlp/policy"

const LADDER_HEIGHTS = PLAYBACK_LADDER_HEIGHTS

function isNoneCodec(value: string | undefined): boolean {
  if (!value) return true
  const lower = value.toLowerCase()
  return lower === "none" || lower === "null"
}

function isAdaptiveProtocol(protocol: string | undefined, type: string | undefined, src: string): boolean {
  const p = (protocol ?? "").toLowerCase()
  const t = (type ?? "").toLowerCase()
  if (p.includes("m3u8") || p.includes("hls") || p.includes("dash") || p.includes("http_dash")) {
    return true
  }
  if (t.includes("mpegurl") || t.includes("dash+xml")) {
    return true
  }
  return /\.m3u8(\?|$)/i.test(src) || /\.mpd(\?|$)/i.test(src)
}

function isCombinedStream(stream: {
  vcodec?: string
  acodec?: string
  protocol?: string
  type?: string
  src: string
}): boolean {
  if (isAdaptiveProtocol(stream.protocol, stream.type, stream.src)) {
    return true
  }
  const hasVideo = !isNoneCodec(stream.vcodec)
  const hasAudio = !isNoneCodec(stream.acodec)
  // Unknown codecs: treat as combined (safer for progressive defaults)
  if (!stream.vcodec && !stream.acodec) {
    return true
  }
  return hasVideo && hasAudio
}

function nearestLadderHeight(height: number | undefined): number | null {
  if (!height || !Number.isFinite(height)) return null
  let best: number | null = null
  let bestDelta = Number.POSITIVE_INFINITY
  for (const target of LADDER_HEIGHTS) {
    const delta = Math.abs(target - height)
    if (delta < bestDelta) {
      best = target
      bestDelta = delta
    }
  }
  return best
}

function toPlaylistStream(
  stream: YtDlpStream,
  kind: PlaylistMediaStream["kind"],
): PlaylistMediaStream {
  return {
    id: stream.id,
    src: stream.src,
    type: stream.type,
    protocol: stream.protocol,
    width: stream.width,
    height: stream.height,
    bitrate: stream.bitrate,
    audioBitrate: stream.audioBitrate,
    label: stream.label,
    isDefault: stream.isDefault,
    kind,
    vcodec: stream.vcodec,
    acodec: stream.acodec,
  }
}

/**
 * Build a bounded catalog of browser-playable single-URL streams:
 * adaptive "Auto" (preferred default) + combined progressive ladder.
 */
export function buildSelectableStreams(input: {
  streams: YtDlpStream[]
  videoVariants?: YtDlpNormalizedVariant[]
  textTracks: YtDlpTextTrack[]
  playableUrl: string | null
}): {
  mediaStreams: PlaylistMediaStream[]
  textTracks: PlaylistTextTrack[]
  defaultStreamId?: string
  defaultTextTrackId?: string
  playableUrl: string
} {
  const adaptive: PlaylistMediaStream[] = []
  const combinedByHeight = new Map<number, PlaylistMediaStream>()
  const combinedOther: PlaylistMediaStream[] = []
  const seenSrc = new Set<string>()

  const consider = (stream: YtDlpStream) => {
    if (!stream.src || seenSrc.has(stream.src)) return
    if (!isHttpOrHttpsUrl(stream.src)) return
    if (!isCombinedStream(stream)) return
    seenSrc.add(stream.src)

    if (isAdaptiveProtocol(stream.protocol, stream.type, stream.src)) {
      adaptive.push(
        toPlaylistStream(
          {
            ...stream,
            id: stream.id || "auto",
            label: stream.label || "Auto",
          },
          "adaptive",
        ),
      )
      return
    }

    const ladder = nearestLadderHeight(stream.height)
    const labeled: PlaylistMediaStream = toPlaylistStream(
      {
        ...stream,
        label:
          stream.label ||
          (stream.height ? `${stream.height}p` : stream.id || " Progressive"),
      },
      "combined",
    )
    if (ladder !== null) {
      const existing = combinedByHeight.get(ladder)
      if (!existing || (stream.height ?? 0) > (existing.height ?? 0)) {
        combinedByHeight.set(ladder, {
          ...labeled,
          label: labeled.label || `${ladder}p`,
        })
      }
    } else {
      combinedOther.push(labeled)
    }
  }

  for (const stream of input.streams) {
    consider(stream)
  }

  // Prefer variants marked combined when streams dump was incomplete
  for (const variant of input.videoVariants ?? []) {
    if (variant.kind !== "combined" && variant.kind !== "video") continue
    if (variant.kind === "video" && isNoneCodec(variant.acodec)) continue
    consider({
      id: variant.id,
      src: variant.src,
      label: variant.label,
      width: variant.width,
      height: variant.height,
      protocol: variant.protocol,
      bitrate: variant.tbr,
      audioBitrate: variant.abr,
      vcodec: variant.vcodec,
      acodec: variant.acodec,
    })
  }

  const ladderStreams = [...combinedByHeight.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, stream]) => stream)

  let mediaStreams = [...adaptive, ...ladderStreams, ...combinedOther].slice(
    0,
    MEDIA_STREAM_CATALOG_LIMIT,
  )

  if (mediaStreams.length === 0 && input.playableUrl) {
    mediaStreams = [
      {
        id: "default",
        src: input.playableUrl,
        isDefault: true,
        label: "Default",
        kind: isAdaptiveProtocol(undefined, undefined, input.playableUrl)
          ? "adaptive"
          : "combined",
      },
    ]
  }

  const preferredDefault =
    mediaStreams.find((s) => s.kind === "adaptive") ??
    mediaStreams.find((s) => s.isDefault) ??
    mediaStreams.find((s) => s.src === input.playableUrl) ??
    mediaStreams[0]

  mediaStreams = mediaStreams.map((stream) => ({
    ...stream,
    isDefault: preferredDefault ? stream.id === preferredDefault.id : false,
  }))

  const textTracks: PlaylistTextTrack[] = input.textTracks
    .slice(0, MEDIA_TEXT_TRACK_CATALOG_LIMIT)
    .filter((track) => isHttpOrHttpsUrl(track.src))
    .map((track) => ({
      id: track.id,
      src: track.src,
      label: track.label,
      language: track.language,
      kind: track.kind,
      type: track.type,
      isDefault: track.isDefault,
    }))

  const defaultText = textTracks.find((track) => track.isDefault)

  return {
    mediaStreams,
    textTracks,
    defaultStreamId: preferredDefault?.id,
    defaultTextTrackId: defaultText?.id,
    playableUrl: preferredDefault?.src ?? input.playableUrl ?? "",
  }
}
