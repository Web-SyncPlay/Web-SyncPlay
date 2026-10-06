"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useMemo, useState } from "react"
import type { RoomPanelProps } from "./page/types"
import { UserAvatar } from "../panel/user/UserAvatar"
import { UsersPanel } from "../panel/user/UsersPanel"

export function UsersStrip(props: RoomPanelProps) {
  const { roomState, send, userId } = props
  const [open, setOpen] = useState(false)
  const participants = useMemo(
    () => Object.values(roomState.participants),
    [roomState.participants],
  )
  const me = participants.find((user) => user.userId === userId)
  const others = participants.filter((user) => user.userId !== userId)
  const onlineCount = participants.filter((user) => user.connected).length

  return (
    <>
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 py-2">
          <Badge variant="secondary">{onlineCount} online</Badge>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {me ? (
              <UserAvatar send={send} user={me} isSelf compact />
            ) : null}
            {others.slice(0, 8).map((user) => (
              <UserAvatar key={user.userId} send={send} user={user} compact />
            ))}
            {others.length > 8 ? (
              <Badge variant="outline">+{others.length - 8}</Badge>
            ) : null}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="min-h-10 touch-manipulation sm:min-h-8"
            onClick={() => setOpen(true)}
          >
            Users
          </Button>
        </CardContent>
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Users</DialogTitle>
          </DialogHeader>
          <UsersPanel {...props} embedded />
        </DialogContent>
      </Dialog>
    </>
  )
}
