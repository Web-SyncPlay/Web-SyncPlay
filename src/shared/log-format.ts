import type { ActionLogEntry, RoomState } from "@/contracts/types"
import { formatClockMs } from "@/shared/time-format"

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

/** Orthogonal facets for the Action Log (Hearst-style category navigation). */
export const logActionCategories = [
  "presence",
  "playback",
  "playlist",
  "error",
] as const

export type LogActionCategory = (typeof logActionCategories)[number]

export const categoryLabelByType: Record<LogActionCategory, string> = {
  presence: "Presence",
  playback: "Playback",
  playlist: "Playlist",
  error: "Errors",
}

const visibleActionTypeSet = new Set<string>(visibleActionTypes)

function payloadString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback
}

export function getActionCategory(action: string): LogActionCategory | null {
  if (action === "participant:error") {
    return "error"
  }
  if (action.startsWith("participant:")) {
    return "presence"
  }
  if (action.startsWith("playback:") || action === "media:played") {
    return "playback"
  }
  if (action.startsWith("playlist:")) {
    return "playlist"
  }
  return null
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
      // Actor is the new owner; prefer stamped username over raw id.
      return `Ownership transferred to ${
        log.actorUsername ?? payloadString(log.payload.nextOwnerId, "unknown")
      }`
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

export type LogFilterConfig = {
  actionLog: ActionLogEntry[]
  /** Empty = all categories. */
  categories?: readonly LogActionCategory[]
  /** Empty / omitted = all actions. Exact action strings for relate-refine. */
  actions?: readonly string[]
  /** Empty / omitted = all users. */
  userIds?: readonly string[]
  /** Legacy single-action filter (maps to `actions`). */
  actionFilter?: string
  /** Legacy single-user filter (maps to `userIds`). */
  userFilter?: string
  query?: string
  timeStartMs?: number | null
  timeEndMs?: number | null
  participantUsernames?: Record<string, string>
}

function resolveActorName(
  log: ActionLogEntry,
  participantUsernames?: Record<string, string>,
): string {
  return (
    log.actorUsername ??
    participantUsernames?.[log.actorUserId] ??
    log.actorUserId
  )
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase()
}

function matchesQuery(
  log: ActionLogEntry,
  query: string,
  participantUsernames?: Record<string, string>,
): boolean {
  const q = normalizeQuery(query)
  if (!q) {
    return true
  }
  const actionLabel =
    log.action in actionLabelByType
      ? actionLabelByType[log.action as VisibleActionType]
      : log.action
  const haystack = [
    log.action,
    actionLabel,
    resolveActorName(log, participantUsernames),
    getActionLogDetails(log),
    log.error ?? "",
  ]
    .join(" ")
    .toLowerCase()
  return haystack.includes(q)
}

function resolveActionFilter(config: LogFilterConfig): readonly string[] {
  if (config.actions && config.actions.length > 0) {
    return config.actions
  }
  if (config.actionFilter && config.actionFilter !== "all") {
    return [config.actionFilter]
  }
  return []
}

function resolveUserFilter(config: LogFilterConfig): readonly string[] {
  if (config.userIds && config.userIds.length > 0) {
    return config.userIds
  }
  if (config.userFilter && config.userFilter !== "all") {
    return [config.userFilter]
  }
  return []
}

export function getFilteredLogs(config: LogFilterConfig): ActionLogEntry[] {
  const categories = config.categories ?? []
  const actions = resolveActionFilter(config)
  const userIds = resolveUserFilter(config)
  const query = config.query ?? ""
  const timeStartMs = config.timeStartMs ?? null
  const timeEndMs = config.timeEndMs ?? null

  return config.actionLog.filter((log) => {
    if (!visibleActionTypeSet.has(log.action)) {
      return false
    }
    const category = getActionCategory(log.action)
    if (
      categories.length > 0 &&
      (category === null || !categories.includes(category))
    ) {
      return false
    }
    if (actions.length > 0 && !actions.includes(log.action)) {
      return false
    }
    if (userIds.length > 0 && !userIds.includes(log.actorUserId)) {
      return false
    }
    if (timeStartMs !== null && log.at < timeStartMs) {
      return false
    }
    if (timeEndMs !== null && log.at > timeEndMs) {
      return false
    }
    if (!matchesQuery(log, query, config.participantUsernames)) {
      return false
    }
    return true
  })
}

/** Count visible entries per category (for facet query previews). */
export function countLogsByCategory(
  actionLog: ActionLogEntry[],
): Record<LogActionCategory, number> {
  const counts: Record<LogActionCategory, number> = {
    presence: 0,
    playback: 0,
    playlist: 0,
    error: 0,
  }
  for (const log of actionLog) {
    if (!visibleActionTypeSet.has(log.action)) {
      continue
    }
    const category = getActionCategory(log.action)
    if (category) {
      counts[category] += 1
    }
  }
  return counts
}

/** Split `text` into plain / highlight segments for the active query. */
export function highlightQuerySegments(
  text: string,
  query: string,
): Array<{ text: string; match: boolean }> {
  const q = query.trim()
  if (!q) {
    return [{ text, match: false }]
  }
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(`(${escaped})`, "ig")
  const parts = text.split(re)
  if (parts.length === 1) {
    return [{ text, match: false }]
  }
  const lowered = q.toLowerCase()
  return parts
    .filter((part) => part.length > 0)
    .map((part) => ({
      text: part,
      match: part.toLowerCase() === lowered,
    }))
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

/** Structured payload rows for details-on-demand expansion. */
export function getActionLogPayloadRows(
  log: ActionLogEntry,
): Array<{ key: string; value: string }> {
  const rows: Array<{ key: string; value: string }> = []
  if (log.error) {
    rows.push({ key: "error", value: log.error })
  }
  for (const [key, value] of Object.entries(log.payload)) {
    if (value === undefined || value === null) {
      continue
    }
    if (typeof value === "number" && /Ms$/.test(key)) {
      rows.push({ key, value: formatClockMs(value) })
      continue
    }
    if (typeof value === "string" || typeof value === "number") {
      rows.push({ key, value: String(value) })
      continue
    }
    if (typeof value === "boolean") {
      rows.push({ key, value: value ? "true" : "false" })
    }
  }
  return rows
}
