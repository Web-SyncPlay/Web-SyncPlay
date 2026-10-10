"use client"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field"
import type { TypedRoomEventSender } from "@/contracts/room-events"
import { cn } from "@/components/lib/utils"
import type { DefaultJoinRole, PublicRoomSecurityState } from "@/contracts/types"
import { Shield } from "lucide-react"

const JOIN_ROLE_OPTIONS: ReadonlyArray<{
  role: DefaultJoinRole
  label: string
}> = [
  { role: "moderator", label: "Moderator" },
  { role: "guest", label: "Guest" },
]

export function RoomDefaultJoinRoleSection(props: {
  roomSecurity: PublicRoomSecurityState
  canManageRoomSecurity: boolean
  send: TypedRoomEventSender
}) {
  const { roomSecurity, canManageRoomSecurity, send } = props
  const defaultJoinRole = roomSecurity.defaultJoinRole ?? "guest"

  const setRole = (role: DefaultJoinRole) => {
    if (role === defaultJoinRole) return
    send("room:default-role:set", { role })
  }

  return (
    <FieldGroup className="gap-3">
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
        <div
          className="inline-flex w-full items-center rounded-lg border bg-background p-0.5"
          role="group"
          aria-label="Default join role"
        >
          {JOIN_ROLE_OPTIONS.map(({ role, label }) => {
            const selected = defaultJoinRole === role
            return (
              <Button
                key={role}
                type="button"
                size="sm"
                variant={selected ? "default" : "ghost"}
                className={cn(
                  "min-h-8 flex-1 touch-manipulation",
                  !selected && "text-muted-foreground",
                )}
                aria-pressed={selected}
                onClick={() => setRole(role)}
              >
                {label}
              </Button>
            )
          })}
        </div>
      ) : (
        <p className="text-sm capitalize text-muted-foreground">
          {defaultJoinRole}
        </p>
      )}
    </FieldGroup>
  )
}
