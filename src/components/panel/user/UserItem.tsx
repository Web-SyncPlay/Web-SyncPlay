import { useInlineEdit } from "@/hooks/use-inline-edit"
import type { TypedRoomEventSender } from "@/lib/room-events"
import { formatClockMs, formatRelativeLastSeen } from "@/lib/time-format"
import { cn } from "@/lib/utils"
import type { ParticipantState } from "@/zod/types"
import { Badge } from "../../ui/badge"
import { Input } from "../../ui/input"
import { Item, ItemActions, ItemContent } from "../../ui/item"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select"
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

  return (
    <Item
      variant={isSelf ? "default" : "outline"}
      className={cn("p-0 pr-2", isSelf && "border-primary/40")}
    >
      <UserAvatar send={send} user={user} isSelf={isSelf} />
      <ItemContent className="py-2">
        {isSelf && inlineEdit.isEditing ? (
          <Input
            className="h-10"
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
          <div>
            <div className="flex items-center gap-2">
              {isSelf && <Badge>You</Badge>}
              <span
                className={cn(
                  "truncate text-lg",
                  isSelf &&
                    "cursor-pointer rounded-md px-1 -mx-1 active:bg-muted/80 sm:hover:bg-muted/60",
                )}
                role={isSelf ? "button" : undefined}
                tabIndex={isSelf ? 0 : undefined}
                title={isSelf ? "Edit display name" : undefined}
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
              <Badge
                variant={user.role === "owner" ? "default" : "outline"}
                className="capitalize"
              >
                {user.role}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <div className="leading-tight text-muted-foreground">
                {user.localPlayback.paused ? "Paused" : "Playing"} at{" "}
                {formatClockMs(user.localPlayback.currentTimeMs)}
              </div>
              <Badge
                variant={
                  user.localPlayback.error
                    ? "destructive"
                    : user.localPlayback.loading
                      ? "outline"
                      : "secondary"
                }
              >
                {user.localPlayback.error
                  ? "Error"
                  : user.localPlayback.loading
                    ? "Loading"
                    : "Ready"}
              </Badge>
            </div>
          </div>
        )}
      </ItemContent>
      <ItemActions>
        <Tooltip>
          <TooltipTrigger>
            <Badge
              variant={user.connected ? "secondary" : "outline"}
              className="h-5 px-1.5 text-[10px]"
            >
              {user.connected ? "Online" : "Offline"}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            {formatRelativeLastSeen(user.lastSeenAt)}
          </TooltipContent>
        </Tooltip>
        {isOwner && !isSelf && (
          <Select
            value={user.role}
            onValueChange={(nextRole) => {
              if (nextRole !== "moderator" && nextRole !== "guest") {
                return
              }
              if (nextRole === user.role) {
                return
              }
              send("participant:role:update", {
                targetUserId: user.userId,
                role: nextRole,
              })
            }}
          >
            <SelectTrigger size="sm">
              <SelectValue className="capitalize" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="moderator">Moderator</SelectItem>
              <SelectItem value="guest">Guest</SelectItem>
            </SelectContent>
          </Select>
        )}
      </ItemActions>
    </Item>
  )
}
