"use client"

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import type { TypedRoomEventSender } from "@/lib/room-events"
import type { RoomSecurityState } from "@/zod/types"
import { LockKeyhole, LockKeyholeOpen } from "lucide-react"
import { useState, type FormEvent, type KeyboardEvent } from "react"

export function RoomJoinPasswordSection(props: {
  roomSecurity: RoomSecurityState
  canManageRoomSecurity: boolean
  send: TypedRoomEventSender
}) {
  const { roomSecurity, canManageRoomSecurity, send } = props
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)

  const handleSetPassword = (event: FormEvent<HTMLFormElement>) => {
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

  const stopMenuKeyHandling = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
  }

  return (
    <FieldGroup className="gap-3">
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
        </FieldContent>
      </Field>

      {canManageRoomSecurity ? (
        <form onSubmit={handleSetPassword} className="flex flex-col gap-2">
          <InputGroup>
            <InputGroupInput
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={stopMenuKeyHandling}
              placeholder={
                roomSecurity.joinPasswordEnabled
                  ? "New password"
                  : "Room password"
              }
              autoComplete="new-password"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton type="submit" variant="secondary">
                {roomSecurity.joinPasswordEnabled ? "Change" : "Set"}
              </InputGroupButton>
              {roomSecurity.joinPasswordEnabled ? (
                <InputGroupButton
                  type="button"
                  variant="ghost"
                  onClick={handleClearPassword}
                >
                  Remove
                </InputGroupButton>
              ) : null}
            </InputGroupAddon>
          </InputGroup>
          <FieldError>{error}</FieldError>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          {roomSecurity.joinPasswordEnabled
            ? "Password protected"
            : "No password"}
        </p>
      )}
    </FieldGroup>
  )
}
