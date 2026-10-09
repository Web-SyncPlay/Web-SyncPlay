import { repairCleanupAndCheckRoomState } from "@/server/repair"
import type { RoomState } from "@/zod/types"

/** In-memory repair/migration; safe inside an `updateRoom` mutate callback. */
export function applyRoomStateRepair(state: RoomState): string[] {
  return repairCleanupAndCheckRoomState(state)
}

export function logRoomStateRepairFindings(input: {
  roomId: string
  source: string
  findings: string[]
}) {
  if (input.findings.length === 0) return
  console.warn(`[realtime] room state repaired during ${input.source}`, {
    roomId: input.roomId,
    findings: input.findings,
  })
}
