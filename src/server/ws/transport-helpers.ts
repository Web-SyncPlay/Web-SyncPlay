/** True when the HTTP upgrade URL targets the realtime WebSocket endpoint. */
export function isWsApiUpgradeUrl(url: string | undefined): boolean {
  if (!url) return false
  return (
    url === "/api/ws" ||
    url.startsWith("/api/ws?") ||
    url.startsWith("/api/ws/")
  )
}

/**
 * Heartbeat liveness: terminate when no pong has been seen within
 * `heartbeatTimeoutMs` (typically 3× the ping interval).
 * Missing `lastPongAtMs` is treated as "just seen" (same as transport attach).
 */
export function shouldTerminateForMissedHeartbeat(params: {
  nowMs: number
  lastPongAtMs: number | undefined
  heartbeatTimeoutMs: number
}): boolean {
  const lastSeen = params.lastPongAtMs ?? params.nowMs
  return params.nowMs - lastSeen > params.heartbeatTimeoutMs
}
