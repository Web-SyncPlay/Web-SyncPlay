"use client"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { TypedRoomEventSender } from "@/lib/room-events"
import type { RoomSecurityState } from "@/zod/types"
import { LockKeyhole, LockKeyholeOpen } from "lucide-react"
import { useState, type SubmitEvent } from "react"

export function RoomJoinPasswordSection(props: {
  roomSecurity: RoomSecurityState
  canManageRoomSecurity: boolean
  send: TypedRoomEventSender
}) {
  const { roomSecurity, canManageRoomSecurity, send } = props
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)

  const handleSetPassword = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!password.trim()) {
      setError("Enter a password before saving.")
      return
    }

    setError(null)
    send("room:password:set", { password })
  }

  const handleClearPassword = () => {
    setError(null)
    setPassword("")
    send("room:password:clear", {})
  }

  const statusLabel = roomSecurity.joinPasswordEnabled
    ? "Password protected"
    : "No password"

  return (
    <FieldGroup>
      <Field>
        <FieldContent>
          <FieldTitle className="flex items-center gap-2">
            {roomSecurity.joinPasswordEnabled ? (
              <LockKeyhole className="size-4" />
            ) : (
              <LockKeyholeOpen className="size-4" />
            )}
            Join password
          </FieldTitle>
          <FieldDescription>
            {canManageRoomSecurity
              ? "Require new users to enter a password before room details are sent."
              : "Only the room owner can change the join password."}
          </FieldDescription>
          <div className="pt-1 text-sm text-muted-foreground">
            {statusLabel}
          </div>
        </FieldContent>
      </Field>

      {canManageRoomSecurity ? (
        <form onSubmit={handleSetPassword} className="flex flex-col gap-2">
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={
              roomSecurity.joinPasswordEnabled
                ? "Enter a new password"
                : "Enter a room password"
            }
            autoComplete="new-password"
          />
          <FieldError>{error}</FieldError>
          <div className="flex flex-wrap gap-2">
            <Button type="submit">
              {roomSecurity.joinPasswordEnabled
                ? "Change password"
                : "Set password"}
            </Button>
            {roomSecurity.joinPasswordEnabled ? (
              <Button
                type="button"
                variant="outline"
                onClick={handleClearPassword}
              >
                Remove password
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </FieldGroup>
  )
}
