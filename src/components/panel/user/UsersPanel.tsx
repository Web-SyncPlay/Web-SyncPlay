"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ItemGroup } from "@/components/ui/item"
import type { RoomPanelProps } from "../../layout/page/types"
import { UserItem } from "./UserItem"
import { selectUsersPanelSlice } from "./users-room-selectors"

/**
 * Intentionally presence-aware: online badges and last-seen tooltips must
 * update on presence ticks. Do not memo-isolate this panel from participants.
 */
export function UsersPanel({ roomState, send, userId }: RoomPanelProps) {
  const { participants } = selectUsersPanelSlice(roomState)
  const list = Object.values(participants)
  const me = list.find((user) => user.userId === userId)
  const others = list.filter((user) => user.userId !== userId)
  const isOwner = me?.role === "owner"

  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle>Users</CardTitle>
      </CardHeader>
      <CardContent>
        <ItemGroup className="flex flex-row flex-wrap gap-3 pt-1">
          {me ? <UserItem send={send} user={me} isSelf /> : null}
          {others.map((user) => (
            <UserItem
              key={user.userId}
              send={send}
              user={user}
              isOwner={isOwner}
            />
          ))}
        </ItemGroup>
      </CardContent>
    </Card>
  )
}
