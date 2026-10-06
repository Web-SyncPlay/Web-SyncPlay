"use client"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field"
import { cn } from "@/lib/utils"
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

  const setRole = (role: DefaultJoinRole) => {
    if (role === defaultJoinRole) {
      return
    }
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
          <Button
            type="button"
            size="sm"
            variant={defaultJoinRole === "moderator" ? "default" : "ghost"}
            className={cn(
              "min-h-8 flex-1 touch-manipulation",
              defaultJoinRole !== "moderator" && "text-muted-foreground",
            )}
            aria-pressed={defaultJoinRole === "moderator"}
            onClick={() => setRole("moderator")}
          >
            Moderator
          </Button>
          <Button
            type="button"
            size="sm"
            variant={defaultJoinRole === "guest" ? "default" : "ghost"}
            className={cn(
              "min-h-8 flex-1 touch-manipulation",
              defaultJoinRole !== "guest" && "text-muted-foreground",
            )}
            aria-pressed={defaultJoinRole === "guest"}
            onClick={() => setRole("guest")}
          >
            Guest
          </Button>
        </div>
      ) : (
        <p className="text-sm capitalize text-muted-foreground">
          {defaultJoinRole}
        </p>
      )}
    </FieldGroup>
  )
}
