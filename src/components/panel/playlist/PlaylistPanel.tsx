"use client"

import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ItemGroup } from "@/components/ui/item"
import { canControlPlaylist } from "@/lib/permissions-utils"
import { formatDurationSeconds } from "@/lib/time-format"
import { RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers"
import { DragDropProvider } from "@dnd-kit/react"
import { isSortable } from "@dnd-kit/react/sortable"
import { Loader2 } from "lucide-react"
import { useState } from "react"
import type { RoomPanelProps } from "../../layout/page/types"
import { PlaylistAddMediaControls } from "./PlaylistAddMediaControls"
import { PlaylistItemRow } from "./PlaylistItemRow"
import {
  nextPlaylistLoopMode,
  PlaylistLoopToggle,
} from "./PlaylistLoopToggle"

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
  const [draftName, setDraftName] = useState<Record<string, string>>({})
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
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

  const commitItemName = (itemId: string, currentName: string) => {
    const rawDraft = draftName[itemId]
    const trimmed = (rawDraft ?? currentName).trim()
    setEditingItemId(null)
    if (!trimmed || trimmed === currentName) {
      setDraftName((prev) => ({ ...prev, [itemId]: currentName }))
      return
    }

    send("playlist:rename", { itemId, name: trimmed })
  }

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
      <CardContent className="flex-1 flex flex-col gap-3">
        <DragDropProvider
          modifiers={(defaults) => [...defaults, RestrictToVerticalAxis]}
          onDragEnd={(dragEvent) => {
            if (dragEvent.canceled) {
              return
            }
            const source = dragEvent.operation.source
            if (!source || !isSortable(source)) {
              return
            }
            if (source.initialIndex === source.index) {
              return
            }

            send("playlist:reorder", {
              from: source.initialIndex,
              to: source.index,
            })
          }}
        >
          <ItemGroup className="gap-3 pt-1 text-sm overflow-y-auto max-h-[80vh]">
            {roomState.playlist.map((x, i) => {
              const isCurrent =
                (roomState.playback.mediaId ??
                  roomState.playlist[roomState.currentIndex]?.id) === x.id
              const itemDuration = renderItemDuration(x.durationSeconds)

              return (
                <PlaylistItemRow
                  key={x.id}
                  item={x}
                  index={i}
                  isCurrent={isCurrent}
                  itemDuration={itemDuration}
                  canControlPlaylist={canManagePlaylist}
                  draftValue={draftName[x.id] ?? x.name}
                  isEditing={editingItemId === x.id}
                  onDraftChange={(next) =>
                    setDraftName((prev) => ({ ...prev, [x.id]: next }))
                  }
                  onEditStart={() => {
                    setDraftName((prev) => ({ ...prev, [x.id]: x.name }))
                    setEditingItemId(x.id)
                  }}
                  onDraftCommit={() => commitItemName(x.id, x.name)}
                  onDraftCancel={() => {
                    setDraftName((prev) => ({ ...prev, [x.id]: x.name }))
                    setEditingItemId(null)
                  }}
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
