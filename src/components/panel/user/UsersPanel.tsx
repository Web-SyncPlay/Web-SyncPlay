"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ItemGroup } from "@/components/ui/item"
import type { RoomPanelProps } from "../../layout/page/types"
import { UserItem } from "./UserItem"

export function UsersPanel({ roomState, send, userId }: RoomPanelProps) {
  const participants = Object.values(roomState.participants)
  const me = participants.find((user) => user.userId === userId)
  const others = participants.filter((user) => user.userId !== userId)
  const isOwner = me?.role === "owner"

  return (
    <Card>
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
