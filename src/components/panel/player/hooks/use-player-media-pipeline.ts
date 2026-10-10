"use client"

import type { MediaPlayerInstance } from "@vidstack/react"
import { useCallback, type RefObject } from "react"
import type { TypedRoomEventSender } from "@/contracts/room-events"
import type { PlaylistItem, ViewerMediaItemPreference } from "@/contracts/types"
import { usePlayerAudioDelay } from "./use-player-audio-delay"
import { usePlayerCaptionPreferences } from "./use-player-caption-preferences"
import { usePlayerLocalTracks } from "./use-player-local-tracks"
import { usePlayerMediaSource } from "./use-player-media-source"

/**
 * Media source resolution, local tracks, captions, and audio delay — everything
 * that prepares the player element once a playlist item / remount is known.
 */
export function usePlayerMediaPipeline(config: {
  current: PlaylistItem | undefined
  viewerPrefs: ViewerMediaItemPreference | undefined
  userId: string
  send: TypedRoomEventSender
  playerRef: RefObject<MediaPlayerInstance | null>
  localBlobFallbackAttemptedRef: RefObject<string | null>
  playerRemountNonce: number
  setPlayerRemountNonce: (updater: (n: number) => number) => void
}) {
  const {
    current,
    viewerPrefs,
    userId,
    send,
    playerRef,
    localBlobFallbackAttemptedRef,
    playerRemountNonce,
    setPlayerRemountNonce,
  } = config

  const {
    activeStream,
    activePlaybackSrc,
    playerSrc,
    useCrossOriginAnonymous,
    viewType,
    setForceLocalRelaySrc,
  } = usePlayerMediaSource({
    current,
    viewerPrefs,
    userId,
    localBlobFallbackAttemptedRef,
  })

  const localTracksAttachKey = `${current?.id ?? "none"}:${activeStream?.id ?? "auto"}:${playerRemountNonce}`
  usePlayerLocalTracks({
    playerRef,
    itemId: current?.id,
    syncKey: localTracksAttachKey,
    enabled: Boolean(activePlaybackSrc),
  })
  const { delayMs, setDelayMs } = usePlayerAudioDelay({
    playerRef,
    attachKey: localTracksAttachKey,
    enabled: Boolean(activePlaybackSrc),
  })
  usePlayerCaptionPreferences({
    playerRef,
    current,
    viewerPrefs,
    send,
    syncKey: localTracksAttachKey,
    enabled: Boolean(activePlaybackSrc),
  })

  const onSelectStreamId = useCallback(
    (streamId: string) => {
      if (!current) {
        return
      }
      send("viewer:media:preferences", {
        itemId: current.id,
        streamId,
      })
      setPlayerRemountNonce((value) => value + 1)
    },
    [current, send, setPlayerRemountNonce],
  )

  return {
    activeStream,
    activePlaybackSrc,
    playerSrc,
    useCrossOriginAnonymous,
    viewType,
    setForceLocalRelaySrc,
    delayMs,
    setDelayMs,
    onSelectStreamId,
  }
}
