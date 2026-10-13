/** Playhead below this while room is playing counts as stuck-at-start. */
export const PRESENCE_STUCK_START_MS = 750

/**
 * Honest Loading for presence while media is buffering or a background tab
 * has not reached canplay after a remount (avoids "Playing at 0:00").
 */
export function resolvePresenceLoading(input: {
  hidden: boolean
  isMediaReady: boolean
  isBuffering: boolean
  roomPaused: boolean
  currentTimeMs: number
}): boolean {
  const notReady = !input.isMediaReady || input.isBuffering
  const stuckAtStart =
    !input.roomPaused &&
    input.currentTimeMs < PRESENCE_STUCK_START_MS &&
    notReady
  return (
    input.isBuffering ||
    (input.hidden && notReady) ||
    (input.hidden && stuckAtStart)
  )
}
