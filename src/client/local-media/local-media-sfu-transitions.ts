/** Pure SFU/P2P/HTTP delivery planning (no mediasoup/WS I/O). */

/** Cooldown after a failed viewer ensure before warming again. */
export const ENSURE_RETRY_COOLDOWN_MS = 3_000

export type LocalMediaDeliveryMode = "sfu" | "p2p" | "http"

export type LocalMediaDeliveryAttempt = {
  mode: LocalMediaDeliveryMode
  /** Warm path: mode can be tried immediately. */
  ready: boolean
}

/** SFU (if available) → P2P (if provider known) → HTTP. Cold SFU may warm without blocking HTTP. */
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

export function pickFirstReadyDeliveryMode(
  attempts: LocalMediaDeliveryAttempt[],
): LocalMediaDeliveryMode | null {
  return attempts.find((a) => a.ready)?.mode ?? null
}

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

/** True when async SFU work still belongs to the current session generation. */
export function isSfuSessionGenerationCurrent(
  sessionGeneration: number,
  workGeneration: number,
): boolean {
  return sessionGeneration === workGeneration
}

export function nextSfuSessionGeneration(current: number): number {
  return current + 1
}

/** Ready ack received and neither side closed. */
export function isSfuViewerChannelReady(input: {
  ready: boolean
  requestProducerClosed: boolean
  consumerClosed: boolean
}): boolean {
  return (
    input.ready && !input.requestProducerClosed && !input.consumerClosed
  )
}

/** File holders publish; they must not also consume as viewers. */
export function shouldActAsSfuViewer(holdsLocalFile: boolean): boolean {
  return !holdsLocalFile
}

export function shouldEnsureSfuProvider(holdsLocalFile: boolean): boolean {
  return holdsLocalFile
}

/** Skip warm when holding the file, ensure in flight, or cooldown active. */
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
 * `requests` → provider consumes viewer request channel;
 * provider blocks → non-holders ensure a viewer.
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
