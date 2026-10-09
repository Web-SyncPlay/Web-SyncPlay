"use client"

import type { TypedRoomEventSender } from "@/lib/room-events"
import type { MediaPlayerInstance } from "@vidstack/react"
import { useEffect, useRef, type RefObject } from "react"
import type {
  PlaylistItem,
  PlaylistTextTrack,
  ViewerMediaItemPreference,
} from "@/zod/types"

function matchCatalogTextTrackId(
  catalog: PlaylistTextTrack[],
  track: {
    id?: string
    label?: string
    language?: string
    src?: string
  },
): string | null {
  if (catalog.length === 0) {
    return null
  }
  const byId = catalog.find((entry) => entry.id && entry.id === track.id)
  if (byId) {
    return byId.id
  }
  const src = track.src?.trim()
  if (src) {
    const bySrc = catalog.find((entry) => entry.src === src)
    if (bySrc) {
      return bySrc.id
    }
  }
  const label = track.label?.trim().toLowerCase()
  const language = track.language?.trim().toLowerCase()
  if (label || language) {
    const byMeta = catalog.find((entry) => {
      const entryLabel = entry.label?.trim().toLowerCase()
      const entryLanguage = entry.language?.trim().toLowerCase()
      if (label && language) {
        return entryLabel === label && entryLanguage === language
      }
      if (label) {
        return entryLabel === label
      }
      return entryLanguage === language
    })
    if (byMeta) {
      return byMeta.id
    }
  }
  return null
}

/**
 * Mirror Vidstack caption menu selections into room viewer prefs so reconnect
 * restores the same catalog text track (or off).
 */
export function usePlayerCaptionPreferences(options: {
  playerRef: RefObject<MediaPlayerInstance | null>
  current: PlaylistItem | undefined
  viewerPrefs: ViewerMediaItemPreference | undefined
  send: TypedRoomEventSender
  syncKey: string
  enabled: boolean
}) {
  const { playerRef, current, viewerPrefs, send, syncKey, enabled } = options
  const viewerPrefsRef = useRef(viewerPrefs)
  const sendRef = useRef(send)
  const itemId = current?.id
  const catalog = current?.textTracks ?? []
  const catalogRef = useRef(catalog)
  /* eslint-disable react-hooks/refs -- latest prefs/send/catalog for track listeners */
  viewerPrefsRef.current = viewerPrefs
  sendRef.current = send
  catalogRef.current = catalog
  /* eslint-enable react-hooks/refs */

  useEffect(() => {
    if (!enabled || !itemId) {
      return
    }

    let cancelled = false
    let attempts = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let player: MediaPlayerInstance | null = null
    // Skip the first mode-change burst from Track `default` application.
    let skipInitial = true

    const publishPreference = () => {
      if (cancelled || !player) {
        return
      }
      const tracks = [...player.textTracks]
      const showing = tracks.find((track) => track.mode === "showing")
      const nextId = showing
        ? matchCatalogTextTrackId(catalogRef.current, showing)
        : null

      // Only persist when the showing track maps to catalog (or off). Ignore
      // in-manifest-only tracks that have no playlist id.
      if (showing && nextId === null && catalogRef.current.length > 0) {
        return
      }
      if (showing && nextId === null && catalogRef.current.length === 0) {
        return
      }

      const prefs = viewerPrefsRef.current
      const currentId =
        prefs?.textTrackId === null
          ? null
          : (prefs?.textTrackId ?? undefined)
      if (currentId === nextId) {
        return
      }
      // Treat "unset prefs + default catalog track showing" as no-op until the
      // user explicitly changes captions.
      if (
        currentId === undefined &&
        nextId !== null &&
        skipInitial
      ) {
        return
      }

      sendRef.current("viewer:media:preferences", {
        itemId,
        textTrackId: nextId,
      })
    }

    const onModeChange = () => {
      if (skipInitial) {
        skipInitial = false
        return
      }
      publishPreference()
    }

    const bind = (instance: MediaPlayerInstance) => {
      player = instance
      instance.textTracks.addEventListener("mode-change", onModeChange)
      // Allow the default Track selection to settle before mirroring.
      window.setTimeout(() => {
        skipInitial = false
      }, 750)
    }

    const unbind = () => {
      if (!player) {
        return
      }
      player.textTracks.removeEventListener("mode-change", onModeChange)
      player = null
    }

    const tryBind = () => {
      if (cancelled) {
        return
      }
      const instance = playerRef.current
      if (!instance) {
        attempts += 1
        if (attempts < 40) {
          retryTimer = setTimeout(tryBind, 100)
        }
        return
      }
      bind(instance)
    }

    tryBind()

    return () => {
      cancelled = true
      if (retryTimer) {
        clearTimeout(retryTimer)
      }
      unbind()
    }
  }, [enabled, itemId, playerRef, syncKey])
}
