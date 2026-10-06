import {
  avatarDataUri,
  avatarStyleLabel,
  avatarStyles,
  resolveStyle,
  type AvatarStyleId,
} from "@/lib/avatar"
import type { TypedRoomEventSender } from "@/lib/room-events"
import { cn } from "@/lib/utils"
import type { ParticipantState } from "@/zod/types"
import { Avatar, AvatarFallback, AvatarImage } from "../../ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu"
import { ItemMedia } from "../../ui/item"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../ui/tooltip"

function AvatarFace({
  user,
  className,
  /** Drop the default Avatar edge ring so it doesn't fight the card border. */
  bare = false,
}: {
  user: ParticipantState
  className?: string
  bare?: boolean
}) {
  return (
    <Avatar
      className={cn(
        "size-16 rounded-none",
        bare && "after:hidden",
        className,
      )}
    >
      <AvatarImage
        className={bare ? "rounded-none" : undefined}
        src={avatarDataUri(user.avatarStyle, user.username)}
        alt={user.username}
      />
      <AvatarFallback className={bare ? "rounded-none" : undefined}>
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
  const avatarClassName = compact ? "size-8 rounded-full" : "size-16"
  const selectedStyle = resolveStyle(user.avatarStyle)
  const face = isSelf ? (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "cursor-pointer ring-offset-background transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          compact
            ? "rounded-full hover:ring-2 hover:ring-primary/40"
            : "rounded-none hover:brightness-95",
        )}
      >
        <AvatarFace
          user={user}
          className={avatarClassName}
          bare={!compact}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={selectedStyle}
          onValueChange={(style) => {
            if (!style) return
            send("participant:update", {
              avatarStyle: style as AvatarStyleId,
            })
          }}
        >
          {avatarStyles.map((style) => (
            <DropdownMenuRadioItem key={style} value={style}>
              {avatarStyleLabel(style)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : (
    <AvatarFace user={user} className={avatarClassName} bare={!compact} />
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

  // Square media flush to the card edge: card border is the only outline
  // (avoids round avatar ring fighting the item border; size stays 64px).
  return (
    <ItemMedia
      className={cn(
        "self-stretch overflow-hidden rounded-none",
        !user.connected && "opacity-50",
      )}
    >
      {face}
    </ItemMedia>
  )
}
