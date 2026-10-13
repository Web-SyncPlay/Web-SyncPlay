/**
 * Honest Loading for presence while media is buffering or a background tab
 * has not reached canplay after a remount (avoids "Playing at 0:00").
 */
export function resolvePresenceLoading(input: {
  hidden: boolean
  isMediaReady: boolean
  isBuffering: boolean
  /** Kept for call-site stability; ready/buffering already cover stuck-at-start. */
  roomPaused: boolean
  currentTimeMs: number
}): boolean {
  const notReady = !input.isMediaReady || input.isBuffering
  // Hidden + not ready covers remount/stuck-at-start; buffering alone is
  // enough while the tab is visible.
  return input.isBuffering || (input.hidden && notReady)
}
