"use client"

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { TypedRoomEventSender } from "@/lib/room-events"
import type { DefaultJoinRole, RoomSecurityState } from "@/zod/types"
import { Shield } from "lucide-react"

export function RoomDefaultJoinRoleSection(props: {
  roomSecurity: RoomSecurityState
  canManageRoomSecurity: boolean
  send: TypedRoomEventSender
}) {
  const { roomSecurity, canManageRoomSecurity, send } = props
  const defaultJoinRole = roomSecurity.defaultJoinRole ?? "moderator"

  const handleRoleChange = (role: DefaultJoinRole | null) => {
    if (!role || role === defaultJoinRole) {
      return
    }
    send("room:default-role:set", { role })
  }

  return (
    <FieldGroup>
      <Field>
        <FieldContent>
          <FieldTitle className="flex items-center gap-2">
            <Shield className="size-4" />
            Default join role
          </FieldTitle>
          <FieldDescription>
            {canManageRoomSecurity
              ? "Role assigned when someone joins for the first time. Moderator can control playback and the playlist."
              : "Only the room owner can change the default join role."}
          </FieldDescription>
        </FieldContent>
      </Field>

      {canManageRoomSecurity ? (
        <Select
          value={defaultJoinRole}
          onValueChange={(nextRole) => {
            if (nextRole !== "moderator" && nextRole !== "guest") {
              return
            }
            handleRoleChange(nextRole)
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue className="capitalize" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="moderator">Moderator</SelectItem>
            <SelectItem value="guest">Guest</SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <p className="text-sm capitalize text-muted-foreground">
          {defaultJoinRole}
        </p>
      )}
    </FieldGroup>
  )
}
