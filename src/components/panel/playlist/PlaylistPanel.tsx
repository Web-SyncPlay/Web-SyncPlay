"use client"

import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ItemGroup } from "@/components/ui/item"
import { canControlPlaylist } from "@/shared/permissions-utils"
import { resolveCurrentPlaylistItemId } from "@/shared/playlist-current"
import { formatDurationSeconds } from "@/shared/time-format"
import { RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers"
import { DragDropProvider } from "@dnd-kit/react"
import { isSortable } from "@dnd-kit/react/sortable"
import { Loader2 } from "lucide-react"
import type { RoomPanelProps } from "../../layout/page/types"
import { PlaylistAddMediaControls } from "./PlaylistAddMediaControls"
import { PlaylistItemRow } from "./PlaylistItemRow"
import {
  nextPlaylistLoopMode,
  PlaylistLoopToggle,
} from "./PlaylistLoopToggle"
import { usePlaylistItemRename } from "./use-playlist-item-rename"

function renderItemDuration(durationSeconds?: number): string | null {
  if (
    typeof durationSeconds !== "number" ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    return null
  }
  return formatDurationSeconds(durationSeconds)
}

export function PlaylistPanel({
  roomState,
  roomId,
  send,
  userId,
  userSecret: _userSecret,
  capabilities,
  hideTitle = false,
}: RoomPanelProps & { hideTitle?: boolean }) {
  const rename = usePlaylistItemRename(send)
  const myRole = roomState.participants[userId]?.role
  const canManagePlaylist =
    canControlPlaylist(myRole) && capabilities.canManagePlaylist
  const playlistLoop = roomState.playback.playlistLoop
  const resolvingCount = roomState.playlist.filter(
    (item) => item.ingestStatus === "resolving",
  ).length

  const cyclePlaylistLoop = () => {
    send("playback:loop:playlist", {
      mode: nextPlaylistLoopMode(playlistLoop),
    })
  }

  const loopToggle = (
    <PlaylistLoopToggle
      mode={playlistLoop}
      interactive={canManagePlaylist}
      onCycle={cyclePlaylistLoop}
    />
  )

  return (
    <>
      <CardHeader className="shrink-0 gap-3">
        {!hideTitle ? <CardTitle>Playlist</CardTitle> : null}
        {canManagePlaylist ? (
          <PlaylistAddMediaControls
            send={send}
            canManagePlaylist={canManagePlaylist}
            roomId={roomId}
            userId={userId}
            endAddon={loopToggle}
          />
        ) : (
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Guests are view-only
            </p>
            {loopToggle}
          </div>
        )}
        {resolvingCount > 0 ? (
          <CardDescription>
            <span className="flex items-center gap-1">
              <Loader2 className="animate-spin" />
              Resolving {resolvingCount} new URL
              {resolvingCount === 1 ? "" : "s"}
              ...
            </span>
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        <DragDropProvider
          modifiers={(defaults) => [...defaults, RestrictToVerticalAxis]}
          onDragEnd={(dragEvent) => {
            if (dragEvent.canceled) return
            const source = dragEvent.operation.source
            if (!source || !isSortable(source)) return
            if (source.initialIndex === source.index) return

            send("playlist:reorder", {
              from: source.initialIndex,
              to: source.index,
            })
          }}
        >
          <ItemGroup className="min-h-0 flex-1 gap-3 overflow-y-auto pt-1 text-sm">
            {roomState.playlist.map((x, i) => {
              const isCurrent = resolveCurrentPlaylistItemId(roomState) === x.id

              return (
                <PlaylistItemRow
                  key={x.id}
                  item={x}
                  index={i}
                  isCurrent={isCurrent}
                  itemDuration={renderItemDuration(x.durationSeconds)}
                  canControlPlaylist={canManagePlaylist}
                  draftValue={rename.draftName[x.id] ?? x.name}
                  isEditing={rename.editingItemId === x.id}
                  onDraftChange={(next) => rename.setDraft(x.id, next)}
                  onEditStart={() => rename.startEdit(x.id, x.name)}
                  onDraftCommit={() => rename.commitEdit(x.id, x.name)}
                  onDraftCancel={() => rename.cancelEdit(x.id, x.name)}
                  onSelect={() => send("playlist:select", { index: i })}
                  onRemove={() => send("playlist:remove", { itemId: x.id })}
                />
              )
            })}
          </ItemGroup>
        </DragDropProvider>
      </CardContent>
    </>
  )
}
