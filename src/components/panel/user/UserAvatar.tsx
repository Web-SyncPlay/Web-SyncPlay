import type { TypedRoomEventSender } from "@/lib/room-events"
import { cn } from "@/lib/utils"
import type { ParticipantState } from "@/zod/types"
import { Avatar, AvatarFallback, AvatarImage } from "../../ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu"
import { ItemMedia } from "../../ui/item"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../ui/tooltip"

const avatarStyles = [
  "adventurer",
  "adventurer-neutral",
  "avataaars",
  "bottts",
  "fun-emoji",
  "lorelei",
  "micah",
  "pixel-art",
] as const

function AvatarFace({
  user,
  className,
}: {
  user: ParticipantState
  className?: string
}) {
  return (
    <Avatar className={cn("size-16", className)}>
      <AvatarImage
        src={`https://api.dicebear.com/9.x/${user.avatarStyle}/svg?seed=${encodeURIComponent(user.username)}`}
        alt={user.username}
      />
      <AvatarFallback>
        {user.username.slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  )
}

export function UserAvatar({
  send,
  user,
  isSelf = false,
  compact = false,
}: {
  send: TypedRoomEventSender
  user: ParticipantState
  isSelf?: boolean
  compact?: boolean
}) {
  const avatarClassName = compact ? "size-8" : "size-16"
  const face = isSelf ? (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full ring-offset-background transition hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <AvatarFace user={user} className={avatarClassName} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {avatarStyles.map((style) => (
          <DropdownMenuItem
            key={style}
            onClick={() => send("participant:update", { avatarStyle: style })}
          >
            {style}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : (
    <AvatarFace user={user} className={avatarClassName} />
  )

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger
          className={cn(
            "inline-flex rounded-full",
            !user.connected && "opacity-50",
            isSelf && "ring-2 ring-primary/50",
          )}
        >
          {face}
        </TooltipTrigger>
        <TooltipContent>
          {user.username}
          {isSelf ? " (you)" : ""}
          {user.connected ? "" : " · offline"}
        </TooltipContent>
      </Tooltip>
    )
  }

  return <ItemMedia>{face}</ItemMedia>
}
