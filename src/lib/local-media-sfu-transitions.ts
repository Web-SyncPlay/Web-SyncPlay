/**
 * Pure SFU viewer/provider state-transition helpers.
 * Runtime (mediasoup, WS) stays in local-media-sfu* / room-socket-local-media-sfu.
 */

/** Cooldown after a failed viewer ensure before warming again. */
export const ENSURE_RETRY_COOLDOWN_MS = 3_000

export type LocalMediaDeliveryMode = "sfu" | "p2p" | "http"

export type LocalMediaDeliveryAttempt = {
  mode: LocalMediaDeliveryMode
  /** True when this mode should be tried now (warm path). */
  ready: boolean
}

/**
 * Ordered attempts: SFU (if available) → P2P (if provider known) → HTTP.
 * Cold SFU can still be warmed in the background without blocking HTTP.
 */
export function planLocalMediaDeliveryAttempts(input: {
  sfuAvailable: boolean
  sfuViewerReady: boolean
  providerUserId: string | null
}): LocalMediaDeliveryAttempt[] {
  const attempts: LocalMediaDeliveryAttempt[] = []
  if (input.sfuAvailable) {
    attempts.push({ mode: "sfu", ready: input.sfuViewerReady })
  }
  if (input.providerUserId) {
    attempts.push({ mode: "p2p", ready: true })
  }
  attempts.push({ mode: "http", ready: true })
  return attempts
}

/** First ready mode in the plan, or null if somehow empty. */
export function pickFirstReadyDeliveryMode(
  attempts: LocalMediaDeliveryAttempt[],
): LocalMediaDeliveryMode | null {
  return attempts.find((a) => a.ready)?.mode ?? null
}

/**
 * After a failed attempt, return the next mode to try (skipping the failed one).
 */
export function nextDeliveryModeAfterFailure(
  attempts: LocalMediaDeliveryAttempt[],
  failed: LocalMediaDeliveryMode,
): LocalMediaDeliveryMode | null {
  const idx = attempts.findIndex((a) => a.mode === failed)
  if (idx < 0) {
    return pickFirstReadyDeliveryMode(attempts)
  }
  for (let i = idx + 1; i < attempts.length; i += 1) {
    if (attempts[i]?.ready) return attempts[i]!.mode
  }
  return null
}

/** Invalidate async SFU work when session generation advances. */
export function isSfuSessionGenerationCurrent(
  sessionGeneration: number,
  workGeneration: number,
): boolean {
  return sessionGeneration === workGeneration
}

/** Bump generation so in-flight producer/ensure work can no-op. */
export function nextSfuSessionGeneration(current: number): number {
  return current + 1
}

/** Viewer channels are usable only after ready ack and while open. */
export function isSfuViewerChannelReady(input: {
  ready: boolean
  requestProducerClosed: boolean
  consumerClosed: boolean
}): boolean {
  return (
    input.ready && !input.requestProducerClosed && !input.consumerClosed
  )
}

/** Local file holders publish; they must not also consume as viewers. */
export function shouldActAsSfuViewer(holdsLocalFile: boolean): boolean {
  return !holdsLocalFile
}

export function shouldEnsureSfuProvider(holdsLocalFile: boolean): boolean {
  return holdsLocalFile
}

/**
 * Fire-and-forget viewer warm: skip when we hold the file, ensure already
 * in flight, or failure cooldown has not elapsed.
 */
export function shouldWarmSfuViewer(input: {
  holdsLocalFile: boolean
  hasInFlightEnsure: boolean
  lastFailureAtMs: number
  nowMs: number
  cooldownMs?: number
}): boolean {
  if (input.holdsLocalFile || input.hasInFlightEnsure) return false
  const cooldown = input.cooldownMs ?? ENSURE_RETRY_COOLDOWN_MS
  return input.nowMs - input.lastFailureAtMs >= cooldown
}

/** Provide now vs queue until capabilities mark SFU available. */
export function planSfuProvideAttempt(
  sfuAvailable: boolean,
): "provide" | "queue" {
  return sfuAvailable ? "provide" : "queue"
}

export type SfuProducerWireAction =
  | "noop"
  | "consume-requests"
  | "ensure-viewer"

/**
 * Route a `local-media:sfu:producer` broadcast to produce/consume work.
 * `requests` kind → provider consumes viewer request channel;
 * provider block channel → non-holders ensure a viewer.
 */
export function decideSfuProducerWireAction(input: {
  sfuAvailable: boolean
  kind: "provider" | "requests" | undefined
  isSelfOwner: boolean
  holdsLocalFile: boolean
}): SfuProducerWireAction {
  if (!input.sfuAvailable) return "noop"
  if (input.kind === "requests") {
    return input.isSelfOwner && input.holdsLocalFile
      ? "consume-requests"
      : "noop"
  }
  return shouldActAsSfuViewer(input.holdsLocalFile)
    ? "ensure-viewer"
    : "noop"
}
