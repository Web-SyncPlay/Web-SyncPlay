import { env } from "@/env"
import type { RoomState } from "@/zod/types"
import { randomUUID } from "node:crypto"

export const trackedActionTypes = new Set<string>([
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
  "room:password:set",
  "room:password:cleared",
  "room:default-role:set",
])

export function appendActionLog(
  state: RoomState,
  entry: Omit<RoomState["actionLog"][number], "id" | "at"> & {
    at?: number
  },
) {
  if (!trackedActionTypes.has(entry.action)) {
    return
  }

  state.actionLog.push({
    id: randomUUID(),
    at: entry.at ?? Date.now(),
    ...entry,
  })

  if (state.actionLog.length > env.ROOM_ACTION_LOG_LIMIT) {
    state.actionLog = state.actionLog.slice(-env.ROOM_ACTION_LOG_LIMIT)
  }
}
