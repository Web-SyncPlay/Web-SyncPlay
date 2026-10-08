"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { clampAudioDelayMs } from "@/lib/audio-delay"
import type { TypedRoomEventSender } from "@/lib/room-events"
import type {
  PlaylistItem,
  PlaylistMediaStream,
  ViewerMediaItemPreference,
} from "@/zod/types"
import { useState } from "react"
import type {
  LocalAudioTrackOption,
  LocalVideoQualityOption,
} from "./hooks/use-player-local-tracks"

export function PlayerMediaPreferencesBar(props: {
  current: PlaylistItem
  activeStream: PlaylistMediaStream | null
  viewerPrefs: ViewerMediaItemPreference | undefined
  send: TypedRoomEventSender
  onStreamChange: () => void
  audioTracks: LocalAudioTrackOption[]
  videoQualities: LocalVideoQualityOption[]
  onSelectAudioTrack: (index: number) => void
  onSelectVideoQuality: (index: number) => void
  audioDelayMs: number
  onAudioDelayChange: (delayMs: number) => void
  onAudioDelayNudge: (deltaMs: number) => void
  showAudioDelay: boolean
}) {
  const {
    current,
    activeStream,
    viewerPrefs,
    send,
    onStreamChange,
    audioTracks,
    videoQualities,
    onSelectAudioTrack,
    onSelectVideoQuality,
    audioDelayMs,
    onAudioDelayChange,
    onAudioDelayNudge,
    showAudioDelay,
  } = props
  const hasStreams = (current.mediaStreams?.length ?? 0) > 1
  const hasTextTracks = (current.textTracks?.length ?? 0) > 0
  const hasAudioTracks = audioTracks.length > 1
  const hasVideoQualities = videoQualities.length > 1
  const selectedAudioTrack =
    audioTracks.find((track) => track.selected) ?? audioTracks[0]
  const selectedAudio = selectedAudioTrack?.id ?? ""
  const selectedQualityOption =
    videoQualities.find((quality) => quality.selected) ?? videoQualities[0]
  const selectedQuality = selectedQualityOption?.id ?? "auto"
  const [delayDraft, setDelayDraft] = useState(String(audioDelayMs))
  const [delayFocused, setDelayFocused] = useState(false)
  const delayDisplay = delayFocused ? delayDraft : String(audioDelayMs)

  if (
    !hasStreams &&
    !hasTextTracks &&
    !hasAudioTracks &&
    !hasVideoQualities &&
    !showAudioDelay
  ) {
    return null
  }

  return (
    <div className="absolute right-3 top-3 z-20 flex max-w-[min(100%,24rem)] flex-wrap items-center justify-end gap-2">
      {hasStreams && (
        <Select
          value={activeStream?.id ?? current.defaultStreamId ?? ""}
          onValueChange={(streamId) => {
            if (!streamId) return
            send("viewer:media:preferences", {
              itemId: current.id,
              streamId,
            })
            onStreamChange()
          }}
        >
          <SelectTrigger
            size="sm"
            className="h-8 min-w-28 border-white/20 bg-black/70 text-xs text-white"
          >
            <SelectValue placeholder="Quality" />
          </SelectTrigger>
          <SelectContent>
            {(current.mediaStreams ?? []).map((stream) => (
              <SelectItem key={stream.id} value={stream.id}>
                {stream.label || stream.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {hasVideoQualities && (
        <Select
          value={selectedQuality}
          onValueChange={(qualityId) => {
            const option = videoQualities.find((entry) => entry.id === qualityId)
            if (!option) return
            onSelectVideoQuality(option.index)
          }}
        >
          <SelectTrigger
            size="sm"
            className="h-8 min-w-28 border-white/20 bg-black/70 text-xs text-white"
          >
            <SelectValue placeholder="Video">
              {selectedQualityOption?.label ?? "Video"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {videoQualities.map((quality) => (
              <SelectItem key={quality.id} value={quality.id}>
                {quality.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {hasAudioTracks && (
        <Select
          value={selectedAudio}
          onValueChange={(trackId) => {
            const option = audioTracks.find((entry) => entry.id === trackId)
            if (!option) return
            onSelectAudioTrack(option.index)
          }}
        >
          <SelectTrigger
            size="sm"
            className="h-8 min-w-28 border-white/20 bg-black/70 text-xs text-white"
          >
            <SelectValue placeholder="Audio">
              {selectedAudioTrack?.label ?? "Audio"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {audioTracks.map((track) => (
              <SelectItem key={track.id} value={track.id}>
                {track.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {hasTextTracks && (
        <Select
          value={
            viewerPrefs?.textTrackId === null
              ? "off"
              : (viewerPrefs?.textTrackId ??
                current.defaultTextTrackId ??
                "off")
          }
          onValueChange={(textTrackId) => {
            send("viewer:media:preferences", {
              itemId: current.id,
              textTrackId: textTrackId === "off" ? null : textTrackId,
            })
          }}
        >
          <SelectTrigger
            size="sm"
            className="h-8 min-w-28 border-white/20 bg-black/70 text-xs text-white"
          >
            <SelectValue placeholder="Captions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="off">Captions off</SelectItem>
            {(current.textTracks ?? []).map((track) => (
              <SelectItem key={track.id} value={track.id}>
                {track.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {showAudioDelay && (
        <div
          className="flex h-8 items-center gap-1 rounded-md border border-white/20 bg-black/70 px-1 text-xs text-white"
          title="Local audio delay for this browser tab only (does not affect room sync)"
        >
          <span className="whitespace-nowrap px-1 text-white/70">Audio delay</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 text-white hover:bg-white/10 hover:text-white"
            onClick={() => {
              setDelayFocused(false)
              onAudioDelayNudge(-50)
            }}
            aria-label="Decrease audio delay by 50 milliseconds"
          >
            −
          </Button>
          <Input
            type="text"
            inputMode="numeric"
            value={delayDisplay}
            aria-label="Audio delay in milliseconds"
            className="h-6 w-[4.25rem] border-white/20 bg-black/40 px-1 text-center text-xs text-white md:text-xs"
            onFocus={() => {
              setDelayDraft(String(audioDelayMs))
              setDelayFocused(true)
            }}
            onChange={(event) => {
              const raw = event.target.value.trim()
              if (raw === "" || raw === "-" || /^-?\d+$/.test(raw)) {
                setDelayDraft(raw)
              }
              if (raw === "" || raw === "-") {
                return
              }
              const parsed = Number(raw)
              if (!Number.isFinite(parsed)) {
                return
              }
              onAudioDelayChange(clampAudioDelayMs(parsed))
            }}
            onBlur={() => {
              setDelayFocused(false)
              const parsed = Number(delayDraft)
              const next = Number.isFinite(parsed)
                ? clampAudioDelayMs(parsed)
                : 0
              onAudioDelayChange(next)
              setDelayDraft(String(next))
            }}
          />
          <span className="text-white/70">ms</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 text-white hover:bg-white/10 hover:text-white"
            onClick={() => {
              setDelayFocused(false)
              onAudioDelayNudge(50)
            }}
            aria-label="Increase audio delay by 50 milliseconds"
          >
            +
          </Button>
        </div>
      )}
    </div>
  )
}
