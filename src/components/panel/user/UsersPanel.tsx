"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ItemGroup } from "@/components/ui/item"
import type { RoomPanelProps } from "../../layout/page/types"
import { UserItem } from "./UserItem"
import { useLocalPlaybackDisplayTick } from "./use-local-playback-display-tick"
import { selectUsersPanelSlice } from "./users-room-selectors"

/**
 * Intentionally presence-aware: online badges and last-seen tooltips must
 * update on presence ticks. Do not memo-isolate this panel from participants.
 */
export function UsersPanel({ roomState, send, userId }: RoomPanelProps) {
  const { participants, playbackRate, currentDurationMs } =
    selectUsersPanelSlice(roomState)
  const list = Object.values(participants)
  const me = list.find((user) => user.userId === userId)
  const others = list.filter((user) => user.userId !== userId)
  const isOwner = me?.role === "owner"
  const nowMs = useLocalPlaybackDisplayTick(list)

  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle>Users</CardTitle>
      </CardHeader>
      <CardContent>
        <ItemGroup className="flex flex-row flex-wrap gap-3 pt-1">
          {me ? (
            <UserItem
              send={send}
              user={me}
              isSelf
              nowMs={nowMs}
              playbackRate={playbackRate}
              durationMs={currentDurationMs}
            />
          ) : null}
          {others.map((user) => (
            <UserItem
              key={user.userId}
              send={send}
              user={user}
              isOwner={isOwner}
              nowMs={nowMs}
              playbackRate={playbackRate}
              durationMs={currentDurationMs}
            />
          ))}
        </ItemGroup>
      </CardContent>
    </Card>
  )
}
