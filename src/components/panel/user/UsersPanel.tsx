"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ItemGroup } from "@/components/ui/item"
import { useMemo } from "react"
import type { RoomPanelProps } from "../../layout/page/types"
import { UserItem } from "./UserItem"

export function UsersPanel({ roomState, send, userId }: RoomPanelProps) {
  const participants = Object.values(roomState.participants)
  const me = participants.find((u) => u.userId === userId)
  const others = participants.filter((u) => u.userId !== userId)
  const isOwner = useMemo(() => (me?.role ?? "guest") === "owner", [me?.role])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Users</CardTitle>
      </CardHeader>
      <CardContent>
        <ItemGroup className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {me && <UserItem send={send} user={me} isSelf={true} />}
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
