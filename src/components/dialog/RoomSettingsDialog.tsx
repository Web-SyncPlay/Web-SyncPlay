"use client"

import { RoomJoinPasswordSection } from "@/components/dialog/RoomJoinPasswordSection"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { TypedRoomEventSender } from "@/lib/room-events"
import type { RoomSecurityState } from "@/zod/types"

export function RoomSettingsDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  roomSecurity?: RoomSecurityState
  canManageRoomSecurity?: boolean
  send?: TypedRoomEventSender
}) {
  const {
    open,
    onOpenChange,
    roomSecurity,
    canManageRoomSecurity = false,
    send,
  } = props

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Room settings</DialogTitle>
          <DialogDescription>
            Manage join security for this room.
          </DialogDescription>
        </DialogHeader>
        {roomSecurity && send ? (
          <RoomJoinPasswordSection
            roomSecurity={roomSecurity}
            canManageRoomSecurity={canManageRoomSecurity}
            send={send}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Settings are unavailable for this session.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
