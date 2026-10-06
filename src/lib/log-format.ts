import { formatClockMs } from "@/lib/time-format"
import type { ActionLogEntry, RoomState } from "@/zod/types"

export const visibleActionTypes = [
  "participant:joined",
  "participant:disconnected",
  "participant:username",
  "participant:role:changed",
  "participant:owner:transferred",
  "participant:error",
  "playback:pause",
  "playback:unpause",
  "playback:rate",
  "playback:seek",
  "playback:loop",
  "playlist:add",
  "playlist:remove",
  "playlist:reorder",
  "media:played",
] as const

export const actionLabelByType: Record<
  (typeof visibleActionTypes)[number],
  string
> = {
  "participant:joined": "User Joined",
  "participant:disconnected": "User Disconnected",
  "participant:username": "Name Changed",
  "participant:role:changed": "Role Changed",
  "participant:owner:transferred": "Owner Transferred",
  "participant:error": "Error",
  "playback:pause": "Paused",
  "playback:unpause": "Unpaused",
  "playback:rate": "Speed Changed",
  "playback:seek": "Seeked",
  "playback:loop": "Loop Changed",
  "playlist:add": "Playlist Add",
  "playlist:remove": "Playlist Remove",
  "playlist:reorder": "Playlist Reorder",
  "media:played": "Media Played",
}

export function getActionLogDetails(log: ActionLogEntry): string {
  if (log.action === "playback:seek") {
    const fromMs = log.payload.fromMs
    const toMs = log.payload.toMs
    if (typeof fromMs === "number" && typeof toMs === "number") {
      return `Seeked from ${formatClockMs(fromMs)} to ${formatClockMs(toMs)}`
    }
    return "Seeked playback"
  }

  if (log.action === "playback:pause" || log.action === "playback:unpause") {
    const atMs = log.payload.atMs
    return typeof atMs === "number"
      ? `${log.action === "playback:pause" ? "Paused" : "Unpaused"} at ${formatClockMs(atMs)}`
      : log.action === "playback:pause"
        ? "Paused playback"
        : "Unpaused playback"
  }

  if (log.action === "playback:loop") {
    const enabled = log.payload.enabled
    const scope =
      typeof log.payload.scope === "string" ? log.payload.scope : "video"
    return `${scope} loop ${enabled ? "enabled" : "disabled"}`
  }

  if (log.action === "playback:rate") {
    const rate = log.payload.playbackRate
    return typeof rate === "number"
      ? `Set playback speed to ${rate}x`
      : "Changed playback speed"
  }

  if (log.action === "playlist:add") {
    return `Added "${String(log.payload.itemName ?? "item")}" to playlist`
  }
  if (log.action === "playlist:remove") {
    return `Removed "${String(log.payload.itemName ?? "item")}" from playlist`
  }
  if (log.action === "playlist:reorder") {
    const from = log.payload.from
    const to = log.payload.to
    if (typeof from === "number" && typeof to === "number") {
      return `Moved "${String(log.payload.itemName ?? "item")}" from ${from + 1} to ${to + 1}`
    }
    return "Reordered playlist item"
  }
  if (log.action === "media:played") {
    return `Played "${String(log.payload.mediaName ?? "media")}"`
  }
  if (log.action === "participant:username") {
    return `Changed name from "${String(log.payload.previousUsername ?? "unknown")}" to "${String(log.payload.nextUsername ?? "unknown")}"`
  }
  if (log.action === "participant:role:changed") {
    const target = String(
      log.payload.targetUsername ?? log.payload.targetUserId ?? "user",
    )
    return `Changed ${target} role from ${String(log.payload.fromRole ?? "unknown")} to ${String(log.payload.toRole ?? "unknown")}`
  }
  if (log.action === "participant:owner:transferred") {
    const nextOwner = String(log.payload.nextOwnerId ?? "unknown")
    return `Ownership transferred to ${nextOwner}`
  }
  if (log.action === "participant:error") {
    return log.error ? `Error: ${log.error}` : "Playback error"
  }
  if (log.action === "participant:joined") {
    return "Joined room"
  }
  if (log.action === "participant:disconnected") {
    return "Disconnected"
  }
  return "Unknown action"
}

export function getFilteredLogs(config: {
  actionLog: ActionLogEntry[]
  actionFilter: string
  userFilter: string
}): ActionLogEntry[] {
  const actionSet = new Set<string>(visibleActionTypes)
  return config.actionLog.filter((log) => {
    if (!actionSet.has(log.action)) {
      return false
    }
    if (config.actionFilter !== "all" && log.action !== config.actionFilter) {
      return false
    }
    if (config.userFilter !== "all" && log.actorUserId !== config.userFilter) {
      return false
    }
    return true
  })
}

export function getLogUsers(
  roomState: RoomState,
): Array<{ id: string; label: string }> {
  const unique = new Map<string, string>()
  for (const log of roomState.actionLog) {
    const label =
      log.actorUsername ??
      roomState.participants[log.actorUserId]?.username ??
      log.actorUserId
    unique.set(log.actorUserId, label)
  }
  return Array.from(unique.entries()).map(([id, label]) => ({ id, label }))
}
