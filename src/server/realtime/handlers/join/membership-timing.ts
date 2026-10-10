/**
 * Pure R2/R3 join membership timing helpers.
 *
 * R2: delay room registry membership (`addSocket`) until after the WATCH
 *     commit so control traffic cannot land on a half-joined socket.
 * R3: keep `joinCommitted` false until registry + presence are settled so
 *     non-join handlers stay gated.
 */

/** R2: presence ref is added only once per socket (multi-tab rejoin skips). */
export function shouldAddPresenceOnJoin(
  isPresenceAlreadyTracked: boolean,
): boolean {
  return !isPresenceAlreadyTracked
}

/**
 * R3: `joinCommitted` may flip true only while the socket is still open and
 * registered — mirrors the post-presence R1 re-check before the flag.
 */
export function canSetJoinCommitted(options: {
  readyState: number
  openState: number
  hasSocketMeta: boolean
}): boolean {
  return (
    options.readyState === options.openState && options.hasSocketMeta
  )
}

/** Action-log join only for first presence or a reconnect from disconnected. */
export function shouldAppendParticipantJoinedLog(
  isPresenceAlreadyTracked: boolean,
  wasConnected: boolean | undefined,
): boolean {
  return !isPresenceAlreadyTracked || !wasConnected
}
