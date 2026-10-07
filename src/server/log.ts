import { env } from "@/env"
import { visibleActionTypes } from "@/lib/log-format"
import {
  roomActionLogMaxAgeMs,
  type RoomState,
} from "@/zod/types"
import { randomUUID } from "node:crypto"

/** Server-only actions (not shown in the room UI filter). */
const serverOnlyActionTypes = [
  "room:password:set",
  "room:password:cleared",
  "room:default-role:set",
] as const

/** Union of UI-visible + ops/security actions persisted on the room. */
export const trackedActionTypes = new Set<string>([
  ...visibleActionTypes,
  ...serverOnlyActionTypes,
])

/** Drop entries older than the room TTL so active rooms cannot retain logs forever. */
export function pruneActionLog(
  actionLog: RoomState["actionLog"],
  now = Date.now(),
): RoomState["actionLog"] {
  const cutoff = now - roomActionLogMaxAgeMs
  let next = actionLog.filter((entry) => entry.at >= cutoff)
  if (next.length > env.ROOM_ACTION_LOG_LIMIT) {
    next = next.slice(-env.ROOM_ACTION_LOG_LIMIT)
  }
  return next
}

export function appendActionLog(
  state: RoomState,
  entry: Omit<RoomState["actionLog"][number], "id" | "at"> & {
    at?: number
  },
) {
  if (!trackedActionTypes.has(entry.action)) {
    return
  }

  const at = entry.at ?? Date.now()
  state.actionLog.push({
    id: randomUUID(),
    ...entry,
    at,
  })

  state.actionLog = pruneActionLog(state.actionLog, at)
}
