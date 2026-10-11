/**
 * Redis / Valkey TTL policy. Room idle retention lives in `@/shared/room-lifecycle`;
 * heartbeat-backed keys use {@link derivedHeartbeatTtlSeconds}. Operators do not
 * tune these — capacity knobs stay in `env.ts` (ROOM_*_LIMIT, YTDLP_TIMEOUT_MS, …).
 */

import {
  roomActionLogMaxAgeMs,
  roomStateTtlSeconds,
} from "@/shared/room-lifecycle"

export { roomActionLogMaxAgeMs, roomStateTtlSeconds }

/** Missed-heartbeat multiplier for Redis keys refreshed by a periodic heartbeat. */
export const HEARTBEAT_TTL_MULTIPLIER = 3

/** TTL (seconds) so a key outlives a couple of missed heartbeats, then clears. */
export function derivedHeartbeatTtlSeconds(intervalMs: number): number {
  return Math.ceil((intervalMs * HEARTBEAT_TTL_MULTIPLIER) / 1000)
}

export const APP_NODE_HEARTBEAT_INTERVAL_MS = 15_000
export const APP_NODE_ALIVE_TTL_SECONDS = derivedHeartbeatTtlSeconds(
  APP_NODE_HEARTBEAT_INTERVAL_MS,
)

/**
 * Refresh room lifecycle key TTLs at most this often per room (in-process).
 * Matches {@link APP_NODE_ALIVE_TTL_SECONDS} so touch cadence and node liveness align.
 */
export const TOUCH_WS_PRESENCE_MIN_INTERVAL_MS =
  APP_NODE_ALIVE_TTL_SECONDS * 1000
