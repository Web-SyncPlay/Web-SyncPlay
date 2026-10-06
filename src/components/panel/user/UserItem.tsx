import { useInlineEdit } from "@/hooks/use-inline-edit"
import type { TypedRoomEventSender } from "@/lib/room-events"
import { formatClockMs, formatRelativeLastSeen } from "@/lib/time-format"
import { cn } from "@/lib/utils"
import type { ParticipantState } from "@/zod/types"
import { Badge } from "../../ui/badge"
import { Input } from "../../ui/input"
import { Item, ItemActions, ItemContent } from "../../ui/item"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip"
import { UserAvatar } from "./UserAvatar"

export function UserItem({
  send,
  user,
  isSelf = false,
  isOwner = false,
}: {
  send: TypedRoomEventSender
  user: ParticipantState
  isSelf?: boolean
  isOwner?: boolean
}) {
  const inlineEdit = useInlineEdit({
    onCommit: (nextValue) =>
      send("participant:update", { username: nextValue }),
  })

  const playbackStatus = user.localPlayback.error
    ? "Error"
    : user.localPlayback.loading
      ? "Loading"
      : "Ready"
  const connectionLabel = user.connected ? "Online" : "Offline"
  const canToggleRole =
    isOwner && !isSelf && (user.role === "moderator" || user.role === "guest")

  const toggleRole = () => {
    if (!canToggleRole) return
    const nextRole = user.role === "moderator" ? "guest" : "moderator"
    send("participant:role:update", {
      targetUserId: user.userId,
      role: nextRole,
    })
  }

  return (
    <Item
      variant={isSelf ? "default" : "outline"}
      className={cn(
        "relative w-72 shrink-0 flex-nowrap overflow-hidden border p-0 pr-2",
        isSelf ? "border-primary/40 bg-primary/5" : "border-border",
      )}
    >
      {isSelf ? (
        <span className="absolute top-1 left-1 z-10 inline-flex items-center rounded-sm bg-card/95 px-1 text-[10px] leading-none font-medium text-primary shadow-sm">
          You
        </span>
      ) : null}
      <UserAvatar send={send} user={user} isSelf={isSelf} />
      <ItemContent className="min-w-0 flex-1 gap-0.5 py-2">
        {isSelf && inlineEdit.isEditing ? (
          <Input
            className="h-9"
            autoFocus
            value={inlineEdit.draft || user.username}
            onChange={(e) => inlineEdit.setDraft(e.target.value)}
            onFocus={() => inlineEdit.reset(user.username)}
            onBlur={() => inlineEdit.commit(user.username)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                inlineEdit.commit(user.username)
                ;(e.target as HTMLInputElement).blur()
              }
              if (e.key === "Escape") {
                inlineEdit.cancel(user.username)
                ;(e.target as HTMLInputElement).blur()
              }
            }}
          />
        ) : (
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  "truncate text-lg leading-tight",
                  isSelf &&
                    "cursor-pointer rounded-md px-1 -mx-1 active:bg-muted/80 sm:hover:bg-muted/60",
                )}
                role={isSelf ? "button" : undefined}
                tabIndex={isSelf ? 0 : undefined}
                title={isSelf ? "Edit display name" : user.username}
                onClick={() => {
                  if (!isSelf) return
                  inlineEdit.start(user.username)
                }}
                onKeyDown={(e) => {
                  if (!isSelf) return
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    inlineEdit.start(user.username)
                  }
                }}
              >
                {user.username}
              </span>
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="truncate text-xs leading-tight text-muted-foreground">
                {user.localPlayback.paused ? "Paused" : "Playing"} at{" "}
                {formatClockMs(user.localPlayback.currentTimeMs)}
              </div>
              <Tooltip>
                <TooltipTrigger>
                  <Badge
                    variant={
                      user.localPlayback.error
                        ? "destructive"
                        : !user.connected
                          ? "outline"
                          : user.localPlayback.loading
                            ? "outline"
                            : "secondary"
                    }
                    className="h-5 shrink-0 px-1.5 text-[10px]"
                  >
                    {connectionLabel} · {playbackStatus}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  {formatRelativeLastSeen(user.lastSeenAt)}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        )}
      </ItemContent>
      <ItemActions className="shrink-0">
        {user.role === "owner" ? (
          <Badge variant="default" className="capitalize">
            Owner
          </Badge>
        ) : canToggleRole ? (
          <Badge
            variant="outline"
            className="cursor-pointer capitalize"
            role="button"
            tabIndex={0}
            title="Click to toggle role"
            aria-label={`Role ${user.role}, click to toggle`}
            onClick={toggleRole}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                toggleRole()
              }
            }}
          >
            {user.role}
          </Badge>
        ) : (
          <Badge variant="outline" className="capitalize">
            {user.role}
          </Badge>
        )}
      </ItemActions>
    </Item>
  )
}
