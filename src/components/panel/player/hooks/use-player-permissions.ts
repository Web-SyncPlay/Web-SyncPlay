"use client"

import type { RoomRole } from "@/contracts/types"
import { canControlPlayback } from "@/shared/permissions-utils"

/** Role is a preselected string so presence map churn cannot invalidate this. */
export function usePlayerPermissions(myRole: RoomRole) {
  return {
    myRole,
    canControlPlayback: canControlPlayback(myRole),
  }
}
