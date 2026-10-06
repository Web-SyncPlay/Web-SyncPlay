import type { YtDlpFailureClassification } from "@/server/media/yt-dlp/classify"

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
