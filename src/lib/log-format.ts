import { formatClockMs } from "@/lib/time-format"
import type { ActionLogEntry, RoomState } from "@/zod/types"

/** Actions shown in the room UI log (subset of server-tracked types). */
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

export type VisibleActionType = (typeof visibleActionTypes)[number]

export const actionLabelByType: Record<VisibleActionType, string> = {
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

const visibleActionTypeSet = new Set<string>(visibleActionTypes)

function payloadString(
  value: unknown,
  fallback: string,
): string {
  return typeof value === "string" && value.length > 0 ? value : fallback
}

export function getActionLogDetails(log: ActionLogEntry): string {
  switch (log.action) {
    case "playback:seek": {
      const fromMs = log.payload.fromMs
      const toMs = log.payload.toMs
      if (typeof fromMs === "number" && typeof toMs === "number") {
        return `Seeked from ${formatClockMs(fromMs)} to ${formatClockMs(toMs)}`
      }
      return "Seeked playback"
    }
    case "playback:pause":
    case "playback:unpause": {
      const verb = log.action === "playback:pause" ? "Paused" : "Unpaused"
      const atMs = log.payload.atMs
      return typeof atMs === "number"
        ? `${verb} at ${formatClockMs(atMs)}`
        : `${verb} playback`
    }
    case "playback:loop": {
      const enabled = log.payload.enabled
      const scope =
        typeof log.payload.scope === "string" ? log.payload.scope : "video"
      return `${scope} loop ${enabled ? "enabled" : "disabled"}`
    }
    case "playback:rate": {
      const rate = log.payload.playbackRate
      return typeof rate === "number"
        ? `Set playback speed to ${rate}x`
        : "Changed playback speed"
    }
    case "playlist:add":
      return `Added "${payloadString(log.payload.itemName, "item")}" to playlist`
    case "playlist:remove":
      return `Removed "${payloadString(log.payload.itemName, "item")}" from playlist`
    case "playlist:reorder": {
      const from = log.payload.from
      const to = log.payload.to
      const name = payloadString(log.payload.itemName, "item")
      if (typeof from === "number" && typeof to === "number") {
        return `Moved "${name}" from ${from + 1} to ${to + 1}`
      }
      return "Reordered playlist item"
    }
    case "media:played":
      return `Played "${payloadString(log.payload.mediaName, "media")}"`
    case "participant:username":
      return `Changed name from "${payloadString(log.payload.previousUsername, "unknown")}" to "${payloadString(log.payload.nextUsername, "unknown")}"`
    case "participant:role:changed": {
      const target = payloadString(
        log.payload.targetUsername ?? log.payload.targetUserId,
        "user",
      )
      return `Changed ${target} role from ${payloadString(log.payload.fromRole, "unknown")} to ${payloadString(log.payload.toRole, "unknown")}`
    }
    case "participant:owner:transferred":
      return `Ownership transferred to ${payloadString(log.payload.nextOwnerId, "unknown")}`
    case "participant:error":
      return log.error ? `Error: ${log.error}` : "Playback error"
    case "participant:joined":
      return "Joined room"
    case "participant:disconnected":
      return "Disconnected"
    default:
      return "Unknown action"
  }
}

export function getFilteredLogs(config: {
  actionLog: ActionLogEntry[]
  actionFilter: string
  userFilter: string
}): ActionLogEntry[] {
  return config.actionLog.filter((log) => {
    if (!visibleActionTypeSet.has(log.action)) {
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

export function formatLogTimestamp(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
}
