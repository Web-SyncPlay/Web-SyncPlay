import { PROXY_DEFAULT_UA, createProxyUrl } from "@/server/media/proxy-token"
import type { PlaylistMediaStream, PlaylistTextTrack } from "@/contracts/types"

function isRemoteHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/**
 * Wraps every distinct remote HTTP(S) URL in proxy tokens for browser playback.
 */
export async function applyRelayToResolvedUrls(input: {
  playableUrl: string
  mediaStreams: PlaylistMediaStream[]
  textTracks: PlaylistTextTrack[]
  roomId?: string
  mediaId?: string
  referer?: string
}): Promise<{
  playableUrl: string
  mediaStreams: PlaylistMediaStream[]
  textTracks: PlaylistTextTrack[]
}> {
  const distinct = new Set<string>()
  if (isRemoteHttpUrl(input.playableUrl)) {
    distinct.add(input.playableUrl)
  }
  for (const stream of input.mediaStreams) {
    if (isRemoteHttpUrl(stream.src)) {
      distinct.add(stream.src)
    }
  }
  for (const track of input.textTracks) {
    if (isRemoteHttpUrl(track.src)) {
      distinct.add(track.src)
    }
  }

  const meta = {
    roomId: input.roomId,
    mediaId: input.mediaId,
    referer: input.referer,
    userAgent: PROXY_DEFAULT_UA,
  }

  const mapped = new Map<string, string>()
  for (const url of distinct) {
    mapped.set(url, await createProxyUrl(url, meta))
  }

  const mapSrc = (url: string) => mapped.get(url) ?? url

  return {
    playableUrl: mapSrc(input.playableUrl),
    mediaStreams: input.mediaStreams.map((stream) => ({
      ...stream,
      src: mapSrc(stream.src),
    })),
    textTracks: input.textTracks.map((track) => ({
      ...track,
      src: mapSrc(track.src),
    })),
  }
}
