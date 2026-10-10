"use client"

import { clampAudioDelayMs } from "@/shared/audio-delay"
import {
  persistAudioDelayMs,
  readAudioDelayMsFromStorage,
} from "@/shared/dom/audio-delay-storage"
import {
  attachLocalAudioDelayGraph,
  type LocalAudioDelayGraph,
} from "@/client/player/local-audio-delay-graph"
import { queryPlayerMediaElement } from "@/shared/dom/player-utils"
import type { MediaPlayerInstance } from "@vidstack/react"
import { useEffect, useRef, useState, type RefObject } from "react"

export function usePlayerAudioDelay(options: {
  playerRef: RefObject<MediaPlayerInstance | null>
  /** Remount / source changes recreate the media element. */
  attachKey: string
  enabled: boolean
}) {
  const { playerRef, attachKey, enabled } = options
  const [delayMs, setDelayMsState] = useState(readAudioDelayMsFromStorage)
  const graphRef = useRef<LocalAudioDelayGraph | null>(null)
  const delayMsRef = useRef(delayMs)

  useEffect(() => {
    delayMsRef.current = delayMs
  }, [delayMs])

  const ensureGraph = () => {
    if (!enabled) {
      return null
    }
    const existing = graphRef.current
    const player = playerRef.current
    const media = queryPlayerMediaElement(player?.el)
    if (!media) {
      return null
    }
    if (existing?.mediaElement === media) {
      return existing
    }

    // Only dispose the previous graph after a successful attach. createMediaElementSource
    // can throw (already captured / unsupported); disposing first would risk silence.
    const graph = attachLocalAudioDelayGraph(media, delayMsRef.current)
    if (!graph) {
      return null
    }
    if (existing) {
      existing.dispose()
    }
    graphRef.current = graph
    return graph
  }

  const setDelayMs = (value: number) => {
    const next = persistAudioDelayMs(value)
    setDelayMsState(next)
    delayMsRef.current = next
    const graph = graphRef.current ?? (next !== 0 ? ensureGraph() : null)
    graph?.setDelayMs(next)
  }

  const nudgeDelayMs = (deltaMs: number) => {
    setDelayMs(clampAudioDelayMs(delayMsRef.current + deltaMs))
  }

  useEffect(() => {
    const previous = graphRef.current
    graphRef.current = null
    previous?.dispose()

    if (!enabled) {
      return
    }

    let cancelled = false
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | null = null

    const tryAttach = () => {
      if (cancelled || delayMsRef.current === 0) {
        return
      }
      const graph = ensureGraph()
      if (graph) {
        graph.setDelayMs(delayMsRef.current)
        return
      }
      attempts += 1
      if (attempts < 50) {
        timer = setTimeout(tryAttach, 100)
      }
    }

    tryAttach()

    return () => {
      cancelled = true
      if (timer) {
        clearTimeout(timer)
      }
      const graph = graphRef.current
      graphRef.current = null
      graph?.dispose()
    }
    // Attach only when the media element identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ensureGraph uses refs
  }, [attachKey, enabled, playerRef])

  return { delayMs, setDelayMs, nudgeDelayMs }
}
