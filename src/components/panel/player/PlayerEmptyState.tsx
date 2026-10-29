"use client"

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import type { TypedRoomEventSender } from "@/contracts/room-events"

import { PlaylistAddMediaControls } from "../playlist/PlaylistAddMediaControls"

export function PlayerEmptyState(props: {
  send: TypedRoomEventSender
  canControlPlayback: boolean
  roomId: string
  userId: string
  /** When false, omit add controls (e.g. playlist rail already shows them). */
  showAddControls?: boolean
  /** Playlist has items but none are playable yet (resolving / error). */
  waitingForMedia?: boolean
}) {
  const {
    send,
    canControlPlayback,
    roomId,
    userId,
    showAddControls = true,
    waitingForMedia = false,
  } = props
  const showControls = showAddControls && canControlPlayback

  return (
    <Empty className="m-3 border-border/60 bg-black/20 text-white">
      <EmptyHeader>
        <EmptyTitle>
          {waitingForMedia ? "Waiting for media" : "No media selected"}
        </EmptyTitle>
        <EmptyDescription className="text-white/75">
          {waitingForMedia
            ? "The current playlist item is still resolving or unavailable."
            : showControls
              ? "Add a media URL or a local file to start playback."
              : "Open the playlist panel to add media or pick an item."}
        </EmptyDescription>
      </EmptyHeader>
      {showControls ? (
        <EmptyContent className="max-w-xl">
          <PlaylistAddMediaControls
            send={send}
            canManagePlaylist={canControlPlayback}
            roomId={roomId}
            userId={userId}
            addButtonLabel="Add first media"
            className="flex w-full flex-wrap items-center justify-center gap-2"
          />
        </EmptyContent>
      ) : null}
    </Empty>
  )
}
