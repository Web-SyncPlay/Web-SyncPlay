/** How long a controller pause/play click suppresses lifecycle enforce. */
export const TRANSPORT_INTENT_INFLIGHT_MS = 1_800

/**
 * Local controller transport intent awaiting authority. Lives in a ref owned
 * by the session controller (handler factories are rebuilt every render).
 */
export type TransportIntent = {
  /** Intent direction: `true` = user asked to pause. */
  paused: boolean
  /** Wall-clock deadline (`Date.now()` ms) after which the intent expires. */
  untilMs: number
}

export type TransportIntentRef = { current: TransportIntent | null }

export function markTransportIntent(
  ref: TransportIntentRef,
  paused: boolean,
  nowMs: number = Date.now(),
): void {
  ref.current = { paused, untilMs: nowMs + TRANSPORT_INTENT_INFLIGHT_MS }
}

/**
 * True while a user pause/play intent is in flight AND the room has not yet
 * converged on it. Lifecycle enforce must not reverse the intent in that
 * window (it would resume/pause the element before authority lands).
 * Self-clears once the room matches the intent or the window expires.
 */
export function isTransportIntentInFlight(
  ref: TransportIntentRef,
  intentPaused: boolean,
  roomPaused: boolean,
  nowMs: number = Date.now(),
): boolean {
  const intent = ref.current
  if (!intent) {
    return false
  }
  if (nowMs >= intent.untilMs || roomPaused === intent.paused) {
    ref.current = null
    return false
  }
  return intent.paused === intentPaused
}