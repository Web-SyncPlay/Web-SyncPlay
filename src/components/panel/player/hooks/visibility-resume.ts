/** After becoming visible, remount if media still is not ready. */
export const VISIBILITY_REMOUNT_GRACE_MS = 2_500

export type VisibilityResumePlan =
  | { action: "apply-clock" }
  | { action: "buffer-and-schedule-remount"; remountAfterMs: number }

/**
 * Decide what to do when a room tab becomes visible again after backgrounding.
 */
export function planVisibilityResume(input: {
  isMediaReady: boolean
}): VisibilityResumePlan {
  if (input.isMediaReady) {
    return { action: "apply-clock" }
  }
  return {
    action: "buffer-and-schedule-remount",
    remountAfterMs: VISIBILITY_REMOUNT_GRACE_MS,
  }
}
