"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { TypedRoomEventSender } from "@/lib/room-events"
import type {
  PlaylistItem,
  PlaylistMediaStream,
  ViewerMediaItemPreference,
} from "@/zod/types"

export function PlayerMediaPreferencesBar(props: {
  current: PlaylistItem
  activeStream: PlaylistMediaStream | null
  viewerPrefs: ViewerMediaItemPreference | undefined
  send: TypedRoomEventSender
  onStreamChange: () => void
}) {
  const { current, activeStream, viewerPrefs, send, onStreamChange } = props
  const hasStreams = (current.mediaStreams?.length ?? 0) > 1
  const hasTextTracks = (current.textTracks?.length ?? 0) > 0

  if (!hasStreams && !hasTextTracks) {
    return null
  }

  return (
    <div className="absolute right-3 top-3 z-20 flex max-w-[min(100%,20rem)] flex-wrap items-center justify-end gap-2">
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
    </div>
  )
}
