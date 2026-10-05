import {
  extractInfo,
  type YtDlpNormalizedVariant,
  type YtDlpStream,
  type YtDlpTextTrack,
} from "@/server/media/yt-dlp"
import type { YtDlpFailureClassification } from "@/server/media/yt-dlp/classify"

export type YtDlpResolvedPayload =
  | {
      extractOk: true
      title: string | null
      durationSeconds: number | null
      playableUrl: string | null
      streams: YtDlpStream[]
      textTracks: YtDlpTextTrack[]
      isLive: boolean | null
      videoVariants: YtDlpNormalizedVariant[]
      audioVariants: YtDlpNormalizedVariant[]
    }
  | {
      extractOk: false
      title: null
      durationSeconds: null
      playableUrl: null
      streams: YtDlpStream[]
      textTracks: YtDlpTextTrack[]
      isLive: null
      videoVariants: YtDlpNormalizedVariant[]
      audioVariants: YtDlpNormalizedVariant[]
      userMessage: string
      classification: YtDlpFailureClassification
    }

export async function resolveWithYtDlp(
  url: string,
): Promise<YtDlpResolvedPayload> {
  const info = await extractInfo(url)
  if (!info.ok) {
    return {
      extractOk: false,
      title: null,
      durationSeconds: null,
      playableUrl: null,
      streams: [],
      textTracks: [],
      isLive: null,
      videoVariants: [],
      audioVariants: [],
      userMessage: info.userMessage,
      classification: info.classification,
    }
  }

  const streamPlayableUrl =
    info.streams.find((stream) => stream.isDefault)?.src ??
    info.streams[0]?.src ??
    null
  const playableUrl = info.bestPlayableUrl ?? streamPlayableUrl

  return {
    extractOk: true,
    title: info.title,
    durationSeconds: info.durationSeconds,
    playableUrl,
    streams: info.streams,
    textTracks: info.textTracks,
    isLive: info.isLive,
    videoVariants: info.videoVariants,
    audioVariants: info.audioVariants,
  }
}
