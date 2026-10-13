/**
 * Room idle retention in Valkey. Active rooms refresh this via touchWsPresence.
 * Not an admin env — product constant (see README / privacy).
 */
export const roomStateTtlSeconds = 3600

/** Ephemeral room action-log max age (matches room Redis TTL). */
export const roomActionLogMaxAgeMs = roomStateTtlSeconds * 1000

/**
 * After the last WS presence leaves, wait this long before destroying room keys.
 * Covers client reconnect (~1s) + join/state timeout without approaching the
 * 60s participant prune grace. Cluster-coordinated via Valkey emptyAt marker.
 */
export const EMPTY_ROOM_DESTROY_GRACE_MS = 15_000
