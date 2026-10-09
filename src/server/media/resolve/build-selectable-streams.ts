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
  // Reject only when audio is explicitly absent (true video-only). yt-dlp often
  // omits acodec on muxed progressive MP4s (e.g. ARD) — those stay playable.
  if (stream.acodec !== undefined && isNoneCodec(stream.acodec)) {
    return false
  }
  return true
}

function isAudioDescriptionStream(stream: {
  src: string
  label?: string
  id?: string
}): boolean {
  const haystack = `${stream.id ?? ""} ${stream.label ?? ""} ${stream.src}`
  return /audio[_\s-]?desc/i.test(haystack)
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

/** Prefer a true HLS/DASH master over per-rendition variant playlists. */
function adaptivePreferenceScore(
  stream: {
    src: string
    isDefault?: boolean
    height?: number
    label?: string
  },
  playableUrl: string | null,
): number {
  let score = 0
  if (playableUrl && stream.src === playableUrl) score += 100
  if (stream.isDefault) score += 50
  // Masters usually omit a fixed height; variants are ladder rungs.
  if (!stream.height) score += 30
  if ((stream.label ?? "").trim().toLowerCase() === "auto") score += 20
  return score
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
  // At most one adaptive entry — ABR rungs belong in the player Quality menu.
  let bestAdaptive: PlaylistMediaStream | null = null
  let bestAdaptiveScore = Number.NEGATIVE_INFINITY
  const combinedByHeight = new Map<number, PlaylistMediaStream>()
  const combinedOther: PlaylistMediaStream[] = []
  let bestAudioDescription: PlaylistMediaStream | null = null
  const seenSrc = new Set<string>()

  const preferLadderCandidate = (
    existing: PlaylistMediaStream | undefined,
    next: PlaylistMediaStream,
  ): boolean => {
    if (!existing) return true
    const existingAd = isAudioDescriptionStream(existing)
    const nextAd = isAudioDescriptionStream(next)
    // Prefer normal audio over audio-description for the height ladder.
    if (existingAd !== nextAd) return existingAd && !nextAd
    return (next.height ?? 0) > (existing.height ?? 0)
  }

  const consider = (stream: YtDlpStream) => {
    if (!stream.src || seenSrc.has(stream.src)) return
    if (!isHttpOrHttpsUrl(stream.src)) return
    if (!isCombinedStream(stream)) return
    seenSrc.add(stream.src)

    if (isAdaptiveProtocol(stream.protocol, stream.type, stream.src)) {
      const candidate = toPlaylistStream(
        {
          ...stream,
          id: stream.id || "auto",
          // Always present as Auto; height/bitrate ladders live in ABR Quality.
          label: "Auto",
        },
        "adaptive",
      )
      const score = adaptivePreferenceScore(candidate, input.playableUrl)
      if (score > bestAdaptiveScore) {
        bestAdaptive = candidate
        bestAdaptiveScore = score
      }
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

    if (isAudioDescriptionStream(stream)) {
      const adLabeled: PlaylistMediaStream = {
        ...labeled,
        id: labeled.id || "audio-description",
        label: "Audio Description",
      }
      if (
        !bestAudioDescription ||
        (adLabeled.height ?? 0) > (bestAudioDescription.height ?? 0)
      ) {
        bestAudioDescription = adLabeled
      }
      // AD progressives are offered as a dedicated Source entry, not the height ladder.
      return
    }

    if (ladder !== null) {
      const existing = combinedByHeight.get(ladder)
      if (preferLadderCandidate(existing, labeled)) {
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

  let mediaStreams = [
    ...(bestAdaptive ? [bestAdaptive] : []),
    ...(bestAudioDescription ? [bestAudioDescription] : []),
    ...ladderStreams,
    ...combinedOther,
  ].slice(0, MEDIA_STREAM_CATALOG_LIMIT)

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
