"use client"

import {
  claimNextNativePlaylistMetadataProbe,
  hasPendingNativePlaylistMetadataProbes,
  releaseNativePlaylistMetadataProbe,
  subscribeNativePlaylistMetadataProbeQueue,
} from "@/client/player/native-playlist-metadata-probe"
import type { TypedRoomEventSender } from "@/contracts/room-events"
import type { PlaylistItem } from "@/contracts/types"
import { sanitizeMediaTitle } from "@/shared/sanitize-display"
import {
  MediaPlayer,
  MediaProvider,
  type MediaPlayerInstance,
} from "@vidstack/react"
import { useEffect, useRef, useState } from "react"

const PROBE_TIMEOUT_MS = 20_000

type ActiveProbe = {
  itemId: string
  sourceUrl: string
  needsTitle: boolean
  needsDuration: boolean
}

/**
 * Short-lived hidden Vidstack embed that fills native (YouTube/Vimeo) catalog
 * title + duration after the local user adds a URL. Does not drive room sync.
 */
export function NativePlaylistMetadataProbeHost(props: {
  playlist: readonly PlaylistItem[]
  userId: string
  send: TypedRoomEventSender
}) {
  const { playlist, userId, send } = props
  const [active, setActive] = useState<ActiveProbe | null>(null)
  const [queueVersion, setQueueVersion] = useState(0)
  const sentTitleRef = useRef(false)
  const sentDurationRef = useRef(false)
  const completedRef = useRef(false)
  const playerRef = useRef<MediaPlayerInstance | null>(null)
  const activeRef = useRef<ActiveProbe | null>(null)
  activeRef.current = active

  useEffect(() => {
    return subscribeNativePlaylistMetadataProbeQueue(() => {
      setQueueVersion((value) => value + 1)
    })
  }, [])

  useEffect(() => {
    if (active) return
    if (!hasPendingNativePlaylistMetadataProbes()) return
    const claimed = claimNextNativePlaylistMetadataProbe({ playlist, userId })
    if (!claimed) return
    sentTitleRef.current = !claimed.needsTitle
    sentDurationRef.current = !claimed.needsDuration
    completedRef.current = false
    setActive({
      itemId: claimed.item.id,
      sourceUrl: claimed.item.sourceUrl,
      needsTitle: claimed.needsTitle,
      needsDuration: claimed.needsDuration,
    })
  }, [active, playlist, userId, queueVersion])

  useEffect(() => {
    if (!active) return

    const timeoutId = window.setTimeout(() => {
      completedRef.current = true
      releaseNativePlaylistMetadataProbe({
        itemId: active.itemId,
        sourceUrl: active.sourceUrl,
        completed: true,
      })
      setActive(null)
    }, PROBE_TIMEOUT_MS)

    return () => {
      window.clearTimeout(timeoutId)
      const current = activeRef.current
      if (!current || current.itemId !== active.itemId) return
      releaseNativePlaylistMetadataProbe({
        itemId: current.itemId,
        sourceUrl: current.sourceUrl,
        completed: completedRef.current,
      })
    }
  }, [active])

  const finishProbe = () => {
    if (!active) return
    completedRef.current = true
    releaseNativePlaylistMetadataProbe({
      itemId: active.itemId,
      sourceUrl: active.sourceUrl,
      completed: true,
    })
    setActive(null)
  }

  const finishIfComplete = () => {
    if (sentTitleRef.current && sentDurationRef.current) {
      finishProbe()
    }
  }

  if (!active) return null

  return (
    <div
      aria-hidden
      inert
      className="pointer-events-none fixed -left-[200vw] top-0 h-px w-px overflow-hidden opacity-0"
    >
      <MediaPlayer
        key={active.itemId}
        ref={playerRef}
        src={active.sourceUrl}
        title=""
        muted
        paused
        autoPlay={false}
        playsInline
        preload="metadata"
        volume={0}
        className="size-px"
        onPlay={() => {
          const player = playerRef.current
          if (player && !player.paused) {
            void player.pause()
          }
        }}
        onTitleChange={(detail) => {
          if (!active.needsTitle || sentTitleRef.current) return
          const title = sanitizeMediaTitle(String(detail ?? ""))
          if (!title) return
          if (title === active.sourceUrl.trim()) return
          sentTitleRef.current = true
          send("playlist:item:title", {
            itemId: active.itemId,
            name: title,
          })
          finishIfComplete()
        }}
        onDurationChange={(detail) => {
          if (!active.needsDuration || sentDurationRef.current) return
          const durationSec = Number(detail)
          if (!Number.isFinite(durationSec) || durationSec <= 0) return
          sentDurationRef.current = true
          send("playlist:item:duration", {
            itemId: active.itemId,
            durationSeconds: Math.round(durationSec),
          })
          finishIfComplete()
        }}
        onError={() => {
          completedRef.current = true
          releaseNativePlaylistMetadataProbe({
            itemId: active.itemId,
            sourceUrl: active.sourceUrl,
            completed: true,
          })
          setActive(null)
        }}
      >
        <MediaProvider />
      </MediaPlayer>
    </div>
  )
}
