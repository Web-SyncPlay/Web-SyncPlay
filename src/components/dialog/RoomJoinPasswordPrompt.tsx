"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LockKeyhole } from "lucide-react"
import { useState, type SubmitEvent } from "react"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty"
import { Kbd } from "../ui/kbd"

export function RoomJoinPasswordPrompt(props: {
  roomId: string
  title: string | null
  onSubmit: (password: string) => void
}) {
  const { roomId, title, onSubmit } = props
  const [password, setPassword] = useState("")

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!password.trim()) {
      return
    }

    onSubmit(password)
  }

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LockKeyhole />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>
          Enter the join password to access room <Kbd>{roomId}</Kbd>.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <form onSubmit={handleSubmit} className="flex gap-2 w-full">
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter room password"
            aria-label="Room join password"
            autoComplete="current-password"
          />
          <Button type="submit">Join room</Button>
        </form>
      </EmptyContent>
    </Empty>
  )
}
