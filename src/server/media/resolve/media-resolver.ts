import { probeCorsPlayback } from "@/server/media/cors/cors-probe"
import { detectNativeSupport } from "@/server/media/providers/native-detect"
import { resolveWithYtDlp } from "@/server/media/providers/yt-dlp-provider"
import { buildSelectableStreams } from "@/server/media/resolve/build-selectable-streams"
import { applyRelayToResolvedUrls } from "@/server/media/resolve/relay-urls"
import { buildStreamPlan } from "@/server/media/stream/stream-plan"
import { extractMetadata } from "@/server/media/yt-dlp"
import { emptyYtDlpCatalog } from "@/server/media/yt-dlp/types"
import { assertPublicHttpUrl } from "@/server/security/url-safety"
import type { PlaylistMediaStream, PlaylistTextTrack } from "@/zod/types"

export type ResolveFailureReason =
  | "metadata_failed"
  | "cors_blocked"
  | "source_unreachable"
  | "unknown"

export type ResolvedMedia = {
  playableUrl: string
  sourceUrl: string
  title: string
  durationSeconds: number | null
  playbackMode: "direct" | "relay"
  mediaStreams: PlaylistMediaStream[]
  defaultStreamId?: string
  textTracks: PlaylistTextTrack[]
  defaultTextTrackId?: string
  failureReason?: ResolveFailureReason
  resolveUserMessage?: string
  /** Known live broadcast (from yt-dlp), null if unknown / VOD. */
  isLive?: boolean | null
}

function unresolvedMedia(
  input: { url: string; name?: string },
  failure: {
    title?: string
    durationSeconds?: number | null
    failureReason: ResolveFailureReason
    resolveUserMessage: string
    isLive?: boolean | null
  },
): ResolvedMedia {
  return {
    playableUrl: input.url,
    sourceUrl: input.url,
    title: failure.title ?? input.name ?? input.url,
    durationSeconds: failure.durationSeconds ?? null,
    playbackMode: "direct",
    mediaStreams: [],
    textTracks: [],
    failureReason: failure.failureReason,
    resolveUserMessage: failure.resolveUserMessage,
    ...(failure.isLive !== undefined ? { isLive: failure.isLive } : {}),
  }
}

export async function resolveMediaSource(input: {
  url: string
  name?: string
  roomId?: string
  mediaId?: string
  /** When false, skip minting proxy tokens (playability probes). Default true. */
  mintRelay?: boolean
}): Promise<ResolvedMedia> {
  const urlSafety = assertPublicHttpUrl(input.url)
  if (!urlSafety.ok) {
    return unresolvedMedia(input, {
      failureReason: "source_unreachable",
      resolveUserMessage: "This URL cannot be fetched for security reasons.",
    })
  }

  const native = detectNativeSupport(input.url)

  // Native providers (YouTube/Vimeo) play without a full yt-dlp extract, but
  // control pages still need catalog title/duration — light metadata only.
  // Direct file URLs skip the spawn and rely on player write-back.
  const ytResolved = native.canPlayNatively
    ? await (async () => {
        const meta = native.isNativeProvider
          ? await extractMetadata(input.url)
          : { title: null as string | null, durationSeconds: null as number | null }
        return {
          extractOk: true as const,
          title: meta.title,
          durationSeconds: meta.durationSeconds,
          playableUrl: input.url as string | null,
          ...emptyYtDlpCatalog(),
          isLive: null as boolean | null,
        }
      })()
    : await resolveWithYtDlp(input.url)

  if (!native.canPlayNatively && !ytResolved.extractOk) {
    return unresolvedMedia(input, {
      failureReason: "metadata_failed",
      resolveUserMessage: ytResolved.userMessage,
    })
  }

  const selectable = buildSelectableStreams({
    streams: ytResolved.streams,
    videoVariants: ytResolved.videoVariants,
    textTracks: ytResolved.textTracks,
    playableUrl: ytResolved.playableUrl ?? input.url,
  })

  if (selectable.mediaStreams.length === 0 || !selectable.playableUrl) {
    return unresolvedMedia(input, {
      title: ytResolved.title ?? input.name ?? input.url,
      durationSeconds: ytResolved.durationSeconds,
      failureReason: "metadata_failed",
      resolveUserMessage: "No playable streams were found for this URL.",
      isLive: ytResolved.isLive,
    })
  }

  let playableUrl = selectable.playableUrl
  let mediaStreams = selectable.mediaStreams
  let textTracks = selectable.textTracks

  const corsAllowed = native.isNativeProvider
    ? true
    : await probeCorsPlayback(playableUrl)

  const streamPlan = buildStreamPlan({
    playableUrl,
    sourceUrl: input.url,
    isNativeProvider: native.isNativeProvider,
    corsAllowed,
  })

  if (streamPlan.playbackMode === "relay" && input.mintRelay !== false) {
    try {
      const wrapped = await applyRelayToResolvedUrls({
        playableUrl,
        mediaStreams,
        textTracks,
        roomId: input.roomId,
        mediaId: input.mediaId,
        referer: input.url,
      })
      playableUrl = wrapped.playableUrl
      mediaStreams = wrapped.mediaStreams
      textTracks = wrapped.textTracks
    } catch {
      return unresolvedMedia(input, {
        title: ytResolved.title ?? input.name ?? input.url,
        durationSeconds: ytResolved.durationSeconds,
        failureReason: "cors_blocked",
        resolveUserMessage:
          "Media requires a proxy but could not be relayed safely.",
        isLive: ytResolved.isLive,
      })
    }
  }

  const defaultStream =
    mediaStreams.find((entry) => entry.id === selectable.defaultStreamId) ??
    mediaStreams.find((entry) => entry.isDefault) ??
    mediaStreams[0]

  return {
    playableUrl: defaultStream?.src ?? playableUrl,
    sourceUrl: input.url,
    title: ytResolved.title ?? input.name ?? input.url,
    durationSeconds: ytResolved.durationSeconds,
    playbackMode: streamPlan.playbackMode,
    mediaStreams: mediaStreams.map((entry) =>
      defaultStream && entry.id === defaultStream.id
        ? { ...entry, isDefault: true }
        : { ...entry, isDefault: false },
    ),
    defaultStreamId: defaultStream?.id,
    textTracks,
    defaultTextTrackId:
      textTracks.find((track) => track.id === selectable.defaultTextTrackId)
        ?.id ?? textTracks.find((track) => track.isDefault)?.id,
    failureReason: undefined,
    isLive: ytResolved.isLive,
  }
}
