"use client"

import type { PlaylistMediaStream } from "@/zod/types"
import { useMediaState } from "@vidstack/react"
import {
  useDefaultLayoutContext,
} from "@vidstack/react/player/layouts/default"
import type { ReactNode } from "react"
import { PlayerAudioDelayMenuSection } from "./PlayerAudioDelayMenuSection"
import { PlayerSourceMenu } from "./PlayerSourceMenu"

function AudioDelayMenuPlacement(props: {
  delayMs: number
  onDelayChange: (delayMs: number) => void
  /** When true, render only if the Audio submenu is hidden. */
  rootFallback?: boolean
}) {
  const { delayMs, onDelayChange, rootFallback = false } = props
  const { noAudioGain } = useDefaultLayoutContext()
  const canSetAudioGain = useMediaState("canSetAudioGain")
  const audioTracks = useMediaState("audioTracks")
  const hasGainSlider = Boolean(canSetAudioGain) && !noAudioGain
  const audioMenuHidden = !hasGainSlider && audioTracks.length <= 1

  if (rootFallback && !audioMenuHidden) {
    return null
  }
  if (!rootFallback && audioMenuHidden) {
    // Audio submenu won't mount; delay is shown via settingsMenuItemsEnd.
    return null
  }

  return (
    <PlayerAudioDelayMenuSection
      delayMs={delayMs}
      onDelayChange={onDelayChange}
    />
  )
}

export function buildPlayerSettingsSlots(options: {
  previousButtonSlot: ReactNode
  nextButtonSlot: ReactNode
  streams: PlaylistMediaStream[]
  selectedStreamId: string
  onSelectStreamId: (streamId: string) => void
  audioDelayMs: number
  onAudioDelayChange: (delayMs: number) => void
  canControlPlayback: boolean
}) {
  const {
    previousButtonSlot,
    nextButtonSlot,
    streams,
    selectedStreamId,
    onSelectStreamId,
    audioDelayMs,
    onAudioDelayChange,
    canControlPlayback,
  } = options

  return {
    beforePlayButton: previousButtonSlot,
    afterPlayButton: nextButtonSlot,
    settingsMenuItemsStart: (
      <PlayerSourceMenu
        streams={streams}
        selectedStreamId={selectedStreamId}
        onSelectStreamId={onSelectStreamId}
      />
    ),
    audioMenuItemsEnd: (
      <AudioDelayMenuPlacement
        delayMs={audioDelayMs}
        onDelayChange={onAudioDelayChange}
      />
    ),
    settingsMenuItemsEnd: (
      <AudioDelayMenuPlacement
        delayMs={audioDelayMs}
        onDelayChange={onAudioDelayChange}
        rootFallback
      />
    ),
    // Dead slot name in 1.15.6; kept harmless for older layouts.
    ...(!canControlPlayback ? { playbackMenuLoop: null } : {}),
  }
}
