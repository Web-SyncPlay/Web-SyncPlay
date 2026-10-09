"use client"

import type { TypedRoomEventSender } from "@/lib/room-events"
import type { MediaPlayerInstance } from "@vidstack/react"
import { useEffect, type RefObject } from "react"
import { useLatestRef } from "@/hooks/use-latest-ref"
import type {
  PlaylistItem,
  PlaylistTextTrack,
  ViewerMediaItemPreference,
} from "@/zod/types"

type TrackLike = {
  id?: string
  label?: string
  language?: string
  src?: string
  mode: string
}

export function matchCatalogTextTrackId(
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
 * Decide whether a text-track mode change should be published as a viewer pref.
 * Returns the next catalog id (or null for off), or `undefined` to skip.
 */
export function resolveCaptionPreferencePublish(input: {
  catalog: PlaylistTextTrack[]
  showing: TrackLike | undefined
  currentPrefId: string | null | undefined
  /** True while restoring prefs / applying Track defaults — do not publish. */
  suppressPublish: boolean
}): string | null | undefined {
  if (input.suppressPublish) {
    return undefined
  }

  const nextId = input.showing
    ? matchCatalogTextTrackId(input.catalog, input.showing)
    : null

  // Only persist when the showing track maps to catalog (or off). Ignore
  // in-manifest-only tracks that have no playlist id.
  if (input.showing && nextId === null) {
    return undefined
  }

  if (input.currentPrefId === nextId) {
    return undefined
  }

  return nextId
}

/** Imperatively apply preferred catalog track (or off) to Vidstack text tracks. */
export function applyCaptionPreferenceToTracks(
  tracks: TrackLike[],
  catalog: PlaylistTextTrack[],
  preferredId: string | null | undefined,
): boolean {
  if (preferredId === undefined) {
    return false
  }

  let changed = false
  for (const track of tracks) {
    const catalogId = matchCatalogTextTrackId(catalog, track)
    const shouldShow =
      preferredId !== null && catalogId !== null && catalogId === preferredId
    const nextMode = shouldShow ? "showing" : "disabled"
    if (track.mode !== nextMode) {
      track.mode = nextMode
      changed = true
    }
  }
  return changed
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
  const viewerPrefsRef = useLatestRef(viewerPrefs)
  const sendRef = useLatestRef(send)
  const itemId = current?.id
  const catalog = current?.textTracks ?? []
  const catalogRef = useLatestRef(catalog)

  useEffect(() => {
    if (!enabled || !itemId) {
      return
    }

    let cancelled = false
    let bindAttempts = 0
    let trackAttempts = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let player: MediaPlayerInstance | null = null
    // Suppress publish while restoring prefs / settling Track defaults.
    let suppressPublish = true

    const clearRetry = () => {
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
    }

    const endSuppressSoon = (delayMs: number) => {
      window.setTimeout(() => {
        if (!cancelled) {
          suppressPublish = false
        }
      }, delayMs)
    }

    const publishPreference = () => {
      if (cancelled || !player) {
        return
      }
      const tracks = [...player.textTracks] as TrackLike[]
      const showing = tracks.find((track) => track.mode === "showing")
      const prefs = viewerPrefsRef.current
      const currentId =
        prefs?.textTrackId === null
          ? null
          : (prefs?.textTrackId ?? undefined)

      const nextId = resolveCaptionPreferencePublish({
        catalog: catalogRef.current,
        showing,
        currentPrefId: currentId,
        suppressPublish,
      })
      if (nextId === undefined) {
        return
      }

      sendRef.current("viewer:media:preferences", {
        itemId,
        textTrackId: nextId,
      })
    }

    const onModeChange = () => {
      // User-initiated (or settled) changes publish immediately — do not drop
      // early real menu picks behind a long skip window.
      publishPreference()
    }

    const applyStoredPreference = (instance: MediaPlayerInstance) => {
      const prefs = viewerPrefsRef.current
      const preferredId =
        prefs?.textTrackId === null
          ? null
          : (prefs?.textTrackId ?? undefined)
      if (preferredId === undefined) {
        endSuppressSoon(100)
        return
      }
      suppressPublish = true
      applyCaptionPreferenceToTracks(
        [...instance.textTracks] as TrackLike[],
        catalogRef.current,
        preferredId,
      )
      // Allow mode-change events from apply to flush before publishing again.
      endSuppressSoon(0)
    }

    const waitForTracksThenApply = (instance: MediaPlayerInstance) => {
      if (cancelled || player !== instance) {
        return
      }
      const tracks = [...instance.textTracks]
      if (tracks.length === 0 && catalogRef.current.length > 0) {
        trackAttempts += 1
        if (trackAttempts < 40) {
          retryTimer = setTimeout(() => waitForTracksThenApply(instance), 100)
          return
        }
        suppressPublish = false
        return
      }
      applyStoredPreference(instance)
    }

    const bind = (instance: MediaPlayerInstance) => {
      player = instance
      suppressPublish = true
      instance.textTracks.addEventListener("mode-change", onModeChange)
      waitForTracksThenApply(instance)
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
        bindAttempts += 1
        if (bindAttempts < 40) {
          retryTimer = setTimeout(tryBind, 100)
        }
        return
      }
      trackAttempts = 0
      bind(instance)
    }

    tryBind()

    return () => {
      cancelled = true
      clearRetry()
      unbind()
    }
  }, [enabled, itemId, playerRef, syncKey, viewerPrefs?.textTrackId])
}
