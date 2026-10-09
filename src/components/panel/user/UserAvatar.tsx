"use client"

import {
  avatarDataUri,
  avatarStyleLabel,
  avatarStyles,
  isAvatarStyleId,
  resolveStyle,
  type AvatarStyleId,
} from "@/lib/avatar"
import type { TypedRoomEventSender } from "@/lib/room-events"
import { cn } from "@/lib/utils"
import type { ParticipantState } from "@/zod/types"
import { useState } from "react"
import { Avatar, AvatarFallback, AvatarImage } from "../../ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu"
import { ItemMedia } from "../../ui/item"
import { Spinner } from "../../ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../ui/tooltip"

function AvatarFace({
  user,
  style,
  className,
  /** Drop the default Avatar edge ring so it doesn't fight the card border. */
  bare = false,
  pending = false,
  compact = false,
}: {
  user: ParticipantState
  style: string
  className?: string
  bare?: boolean
  pending?: boolean
  compact?: boolean
}) {
  return (
    <Avatar
      className={cn(
        "relative size-16 rounded-none",
        bare && "after:hidden",
        className,
      )}
    >
      <AvatarImage
        key={style}
        className={cn(
          "animate-in fade-in-0 duration-200",
          bare ? "rounded-none" : undefined,
          pending && "opacity-50 transition-opacity duration-200",
        )}
        src={avatarDataUri(style, user.username)}
        alt={user.username}
      />
      <AvatarFallback className={bare ? "rounded-none" : undefined}>
        {user.username.slice(0, 2).toUpperCase()}
      </AvatarFallback>
      {pending ? (
        <span
          className="absolute inset-0 z-10 flex items-center justify-center bg-background/35 animate-in fade-in-0 duration-150"
          aria-hidden
        >
          <Spinner
            className={cn("text-foreground", compact ? "size-3.5" : "size-5")}
          />
        </span>
      ) : null}
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
  const confirmedStyle = resolveStyle(user.avatarStyle)
  const [pendingStyle, setPendingStyle] = useState<AvatarStyleId | null>(null)

  const displayStyle = pendingStyle ?? confirmedStyle
  const isPending =
    pendingStyle !== null && confirmedStyle !== pendingStyle

  const face = isSelf ? (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "cursor-pointer ring-offset-background transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          compact
            ? "rounded-full hover:ring-2 hover:ring-primary/40"
            : "rounded-none hover:brightness-95",
        )}
        aria-busy={isPending || undefined}
      >
        <AvatarFace
          user={user}
          style={displayStyle}
          className={avatarClassName}
          bare={!compact}
          pending={isPending}
          compact={compact}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={displayStyle}
          onValueChange={(style) => {
            if (!isAvatarStyleId(style) || style === displayStyle) return
            setPendingStyle(style)
            send("participant:update", {
              avatarStyle: style,
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
    <AvatarFace
      user={user}
      style={displayStyle}
      className={avatarClassName}
      bare={!compact}
      compact={compact}
    />
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
