"use client"

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import type { TypedRoomEventSender } from "@/lib/room-events"
import { PlaylistAddMediaControls } from "../playlist/PlaylistAddMediaControls"

export function PlayerEmptyState(props: {
  send: TypedRoomEventSender
  canControlPlayback: boolean
  roomId: string
  userId: string
}) {
  const { send, canControlPlayback, roomId, userId } = props
  return (
    <Empty className="m-3 border-border/60 bg-black/20 text-white">
      <EmptyHeader>
        <EmptyTitle>No media selected</EmptyTitle>
        <EmptyDescription className="text-white/75">
          Add a media URL or a local file to start playback.
        </EmptyDescription>
      </EmptyHeader>
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
    </Empty>
  )
}
