/** WebSocket ping interval. Not an admin env — product constant. */
export const WS_HEARTBEAT_INTERVAL_MS = 5_000

/** Terminate if no pong within this many missed ping intervals (same 3× as Redis heartbeat TTLs). */
export const WS_HEARTBEAT_TIMEOUT_MS = WS_HEARTBEAT_INTERVAL_MS * 3
