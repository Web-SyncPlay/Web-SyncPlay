"use client"

import {
  MediaPlayer,
  type MediaPlayerInstance,
  MediaProvider,
} from "@vidstack/react"
import { useEffect, useRef, useState } from "react"

import {
  claimNextNativePlaylistMetadataProbe,
  hasPendingNativePlaylistMetadataProbes,
  releaseNativePlaylistMetadataProbe,
  subscribeNativePlaylistMetadataProbeQueue,
} from "@/client/player/native-playlist-metadata-probe"
import type { TypedRoomEventSender } from "@/contracts/room-events"
import type { PlaylistItem } from "@/contracts/types"
import { sanitizeMediaTitle } from "@/shared/sanitize-display"

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
    const next: ActiveProbe = {
      itemId: claimed.item.id,
      sourceUrl: claimed.item.sourceUrl,
      needsTitle: claimed.needsTitle,
      needsDuration: claimed.needsDuration,
    }
    // Defer setState out of the effect body (react-hooks/set-state-in-effect).
    let applied = false
    const timer = window.setTimeout(() => {
      applied = true
      sentTitleRef.current = !claimed.needsTitle
      sentDurationRef.current = !claimed.needsDuration
      completedRef.current = false
      setActive(next)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      if (!applied) {
        releaseNativePlaylistMetadataProbe({
          itemId: claimed.item.id,
          sourceUrl: claimed.item.sourceUrl,
          completed: false,
        })
      }
    }
  }, [active, playlist, userId, queueVersion])

  useEffect(() => {
    if (!active) return
    const probe = active

    const timeoutId = window.setTimeout(() => {
      completedRef.current = true
      releaseNativePlaylistMetadataProbe({
        itemId: probe.itemId,
        sourceUrl: probe.sourceUrl,
        completed: true,
      })
      setActive(null)
    }, PROBE_TIMEOUT_MS)

    return () => {
      window.clearTimeout(timeoutId)
      releaseNativePlaylistMetadataProbe({
        itemId: probe.itemId,
        sourceUrl: probe.sourceUrl,
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
      className="pointer-events-none fixed top-0 -left-[200vw] h-px w-px overflow-hidden opacity-0"
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
        // Off-screen probe never intersects; default load="visible" never loads.
        load="eager"
        preload="metadata"
        volume={0}
        className="size-px"
        onPlay={() => {
          const player = playerRef.current
          if (!player) return
          try {
            if (!player.paused) {
              void Promise.resolve(player.pause()).catch(() => {})
            }
          } catch {
            // Provider may already be tearing down.
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
