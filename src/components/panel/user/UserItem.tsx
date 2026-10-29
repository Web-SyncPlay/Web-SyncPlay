import { AlertCircle, Loader2, Pause, Play } from "lucide-react"

import { cn } from "@/components/lib/utils"
import type { TypedRoomEventSender } from "@/contracts/room-events"
import type { ParticipantState } from "@/contracts/types"
import { useInlineEdit } from "@/hooks/use-inline-edit"
import { extrapolateLocalPlaybackTimeMs } from "@/shared/local-playback-display"
import { formatClockMs, formatRelativeLastSeen } from "@/shared/time-format"

import { Badge } from "../../ui/badge"
import { Input } from "../../ui/input"
import { Item, ItemActions, ItemContent } from "../../ui/item"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip"
import { UserAvatar } from "./UserAvatar"

type PlaybackTransport = "playing" | "paused" | "loading" | "error"

function playbackTransport(
  playback: ParticipantState["localPlayback"],
): PlaybackTransport {
  if (playback.error) return "error"
  if (playback.loading) return "loading"
  return playback.paused ? "paused" : "playing"
}

function playbackTransportLabel(transport: PlaybackTransport): string {
  switch (transport) {
    case "error":
      return "Error"
    case "loading":
      return "Loading"
    case "paused":
      return "Paused"
    case "playing":
      return "Playing"
  }
}

function playbackReadinessLabel(
  playback: ParticipantState["localPlayback"],
): string {
  if (playback.error) return "Error"
  if (playback.loading) return "Loading"
  return "Ready"
}

function playbackBadgeVariant(
  user: ParticipantState,
): "destructive" | "outline" | "secondary" {
  if (user.localPlayback.error) return "destructive"
  if (!user.connected || user.localPlayback.loading) return "outline"
  return "secondary"
}

function PlaybackTransportIcon({
  transport,
}: {
  transport: PlaybackTransport
}) {
  switch (transport) {
    case "error":
      return <AlertCircle aria-hidden />
    case "loading":
      return <Loader2 className="animate-spin" aria-hidden />
    case "paused":
      return <Pause aria-hidden />
    case "playing":
      return <Play aria-hidden />
  }
}

function roleDescription(role: ParticipantState["role"]): string {
  switch (role) {
    case "owner":
      return "Room owner — controls playback, playlist, and who can moderate."
    case "moderator":
      return "Moderator — can control playback and the playlist."
    case "guest":
      return "Guest — can watch, but cannot control playback or the playlist."
  }
}

function roleToggleHint(role: ParticipantState["role"]): string | null {
  if (role === "moderator") return "Click to demote to guest."
  if (role === "guest") return "Click to promote to moderator."
  return null
}

function RoleBadge(props: {
  user: ParticipantState
  canToggle: boolean
  onToggle: () => void
  isSelf?: boolean
}) {
  const { user, canToggle, onToggle, isSelf = false } = props
  const description = roleDescription(user.role)
  const toggleHint = canToggle ? roleToggleHint(user.role) : null
  const selfRoleAttrs = isSelf ? { "data-self-role": user.role } : null

  const badge =
    user.role === "owner" ? (
      <Badge variant="default" className="capitalize" {...selfRoleAttrs}>
        Owner
      </Badge>
    ) : canToggle ? (
      <Badge
        variant="outline"
        className="cursor-pointer capitalize"
        role="button"
        tabIndex={0}
        aria-label={`${description} ${toggleHint}`}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            onToggle()
          }
        }}
        {...selfRoleAttrs}
      >
        {user.role}
      </Badge>
    ) : (
      <Badge variant="outline" className="capitalize" {...selfRoleAttrs}>
        {user.role}
      </Badge>
    )

  return (
    <Tooltip>
      {/* Span trigger avoids nesting a button when the badge is toggleable. */}
      <TooltipTrigger className="inline-flex" render={<span />}>
        {badge}
      </TooltipTrigger>
      <TooltipContent
        className={
          toggleHint ? "flex-col items-start gap-0.5 text-left" : undefined
        }
      >
        {toggleHint ? (
          <>
            <span>{description}</span>
            <span>{toggleHint}</span>
          </>
        ) : (
          description
        )}
      </TooltipContent>
    </Tooltip>
  )
}

export function UserItem({
  send,
  user,
  isSelf = false,
  isOwner = false,
  nowMs,
  playbackRate = 1,
  durationMs = null,
}: {
  send: TypedRoomEventSender
  user: ParticipantState
  isSelf?: boolean
  isOwner?: boolean
  /** Shared wall clock for playhead extrapolation between presence samples. */
  nowMs: number
  playbackRate?: number
  durationMs?: number | null
}) {
  const inlineEdit = useInlineEdit({
    onCommit: (nextValue) =>
      send("participant:update", { username: nextValue }),
  })

  const connectionLabel = user.connected ? "Online" : "Offline"
  const canToggleRole =
    isOwner && !isSelf && (user.role === "moderator" || user.role === "guest")
  const displayTimeMs = extrapolateLocalPlaybackTimeMs(
    user.localPlayback,
    nowMs,
    { playbackRate, durationMs },
  )
  const clockLabel = formatClockMs(displayTimeMs)
  const transport = playbackTransport(user.localPlayback)
  const transportLabel = playbackTransportLabel(transport)
  const readinessLabel = playbackReadinessLabel(user.localPlayback)
  // Prefer the most actionable signal in the compact chip; full detail is in the tooltip.
  const statusSummaryLabel = user.localPlayback.error
    ? "Error"
    : !user.connected
      ? "Offline"
      : user.localPlayback.loading
        ? "Loading"
        : "Ready"
  const statusFullParts = [
    `${transportLabel} at ${clockLabel}`,
    connectionLabel,
  ]
  if (readinessLabel !== transportLabel) {
    statusFullParts.push(readinessLabel)
  }
  const statusFullLabel = statusFullParts.join(" · ")

  const toggleRole = () => {
    if (!canToggleRole) return
    send("participant:role:update", {
      targetUserId: user.userId,
      role: user.role === "moderator" ? "guest" : "moderator",
    })
  }

  return (
    <Item
      variant={isSelf ? "default" : "outline"}
      className={cn(
        "relative w-80 shrink-0 flex-nowrap overflow-hidden p-0 pr-2",
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
            onChange={(event) => inlineEdit.setDraft(event.target.value)}
            onFocus={() => inlineEdit.reset(user.username)}
            onBlur={() => inlineEdit.commit(user.username)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                inlineEdit.commit(user.username)
                ;(event.target as HTMLInputElement).blur()
              }
              if (event.key === "Escape") {
                inlineEdit.cancel(user.username)
                ;(event.target as HTMLInputElement).blur()
              }
            }}
          />
        ) : (
          <>
            <span
              className={cn(
                "truncate text-lg leading-tight",
                isSelf &&
                  "-mx-1 cursor-pointer rounded-md px-1 active:bg-muted/80 sm:hover:bg-muted/60",
              )}
              role={isSelf ? "button" : undefined}
              tabIndex={isSelf ? 0 : undefined}
              title={isSelf ? "Edit display name" : user.username}
              onClick={() => {
                if (!isSelf) return
                inlineEdit.start(user.username)
              }}
              onKeyDown={(event) => {
                if (!isSelf) return
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  inlineEdit.start(user.username)
                }
              }}
            >
              {user.username}
            </span>
            <Tooltip>
              <TooltipTrigger
                className="inline-flex max-w-full"
                render={<span />}
              >
                <Badge
                  variant={playbackBadgeVariant(user)}
                  className="h-5 max-w-full shrink px-1.5 text-[10px]"
                  aria-label={statusFullLabel}
                  data-playback-state={transportLabel}
                  data-playback-time={clockLabel}
                  {...(isSelf ? { "data-self-playback": "" } : {})}
                >
                  <PlaybackTransportIcon transport={transport} />
                  <span className="tabular-nums">{clockLabel}</span>
                  <span aria-hidden className="opacity-50">
                    ·
                  </span>
                  <span className="truncate">{statusSummaryLabel}</span>
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="flex-col items-start gap-0.5 text-left">
                <span>{statusFullLabel}</span>
                <span>{formatRelativeLastSeen(user.lastSeenAt)}</span>
              </TooltipContent>
            </Tooltip>
          </>
        )}
      </ItemContent>
      <ItemActions className="shrink-0">
        <RoleBadge
          user={user}
          canToggle={canToggleRole}
          onToggle={toggleRole}
          isSelf={isSelf}
        />
      </ItemActions>
    </Item>
  )
}
