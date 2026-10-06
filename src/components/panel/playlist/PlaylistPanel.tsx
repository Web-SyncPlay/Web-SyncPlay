"use client"

import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ItemGroup } from "@/components/ui/item"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { canControlPlaylist } from "@/lib/permissions-utils"
import { formatDurationSeconds } from "@/lib/time-format"
import type { LoopMode } from "@/zod/types"
import { RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers"
import { DragDropProvider } from "@dnd-kit/react"
import { isSortable } from "@dnd-kit/react/sortable"
import { Loader2 } from "lucide-react"
import { useState } from "react"
import type { RoomPanelProps } from "../../layout/page/types"
import { PlaylistAddMediaControls } from "./PlaylistAddMediaControls"
import { PlaylistItemRow } from "./PlaylistItemRow"

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
  send,
  userId,
  userSecret: _userSecret,
  capabilities,
}: RoomPanelProps) {
  const [draftName, setDraftName] = useState<Record<string, string>>({})
  const myRole = roomState.participants[userId]?.role
  const canManagePlaylist =
    canControlPlaylist(myRole) && capabilities.canManagePlaylist
  const playlistLoopLabels: Record<LoopMode, string> = {
    off: "Off",
    once: "Once",
    always: "Always",
  }
  const totalDurationSeconds = roomState.playlist.reduce((sum, item) => {
    if (
      typeof item.durationSeconds === "number" &&
      Number.isFinite(item.durationSeconds) &&
      item.durationSeconds > 0
    ) {
      return sum + item.durationSeconds
    }
    return sum
  }, 0)
  const resolvingCount = roomState.playlist.filter(
    (item) => item.ingestStatus === "resolving",
  ).length

  const commitItemName = (itemId: string, currentName: string) => {
    const rawDraft = draftName[itemId]
    const trimmed = (rawDraft ?? currentName).trim()
    if (!trimmed || trimmed === currentName) {
      setDraftName((prev) => ({ ...prev, [itemId]: currentName }))
      return
    }

    send("playlist:rename", { itemId, name: trimmed })
  }

  return (
    <>
      <CardHeader className="shrink-0">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Playlist</CardTitle>
          <div className="flex items-center gap-2">
            Loop
            {canManagePlaylist ? (
              <Select
                value={roomState.playback.playlistLoop}
                onValueChange={(value) => {
                  if (value !== "off" && value !== "once" && value !== "always")
                    return
                  send("playback:loop:playlist", { mode: value })
                }}
              >
                <SelectTrigger size="sm">
                  <SelectValue className="capitalize" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">Off</SelectItem>
                  <SelectItem value="once">Once</SelectItem>
                  <SelectItem value="always">Always</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <p className="text-xs text-muted-foreground">
                {playlistLoopLabels[roomState.playback.playlistLoop]}
              </p>
            )}
          </div>
        </div>
        <CardDescription>
          {!canManagePlaylist && <span>Playlist is view-only here.</span>}
          {resolvingCount > 0 && (
            <span className="flex items-center gap-1">
              <Loader2 className="animate-spin" />
              Resolving {resolvingCount} new URL
              {resolvingCount === 1 ? "" : "s"}
              ...
            </span>
          )}
          <span>
            Total length: {formatDurationSeconds(totalDurationSeconds)}
          </span>
        </CardDescription>
        <PlaylistAddMediaControls
          send={send}
          canManagePlaylist={canManagePlaylist}
        />
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
          <ItemGroup className="gap-2 text-sm overflow-y-auto max-h-[80vh]">
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
                  playlistLength={roomState.playlist.length}
                  draftValue={draftName[x.id] ?? x.name}
                  onDraftChange={(next) =>
                    setDraftName((prev) => ({ ...prev, [x.id]: next }))
                  }
                  onDraftStart={() =>
                    setDraftName((prev) => ({ ...prev, [x.id]: x.name }))
                  }
                  onDraftCommit={() => commitItemName(x.id, x.name)}
                  onDraftCancel={() =>
                    setDraftName((prev) => ({ ...prev, [x.id]: x.name }))
                  }
                  onMoveUp={() =>
                    send("playlist:reorder", {
                      from: i,
                      to: Math.max(0, i - 1),
                    })
                  }
                  onMoveDown={() =>
                    send("playlist:reorder", {
                      from: i,
                      to: Math.min(roomState.playlist.length - 1, i + 1),
                    })
                  }
                  onRetry={() => send("playlist:retry", { itemId: x.id })}
                />
              )
            })}
          </ItemGroup>
        </DragDropProvider>
      </CardContent>
    </>
  )
}
