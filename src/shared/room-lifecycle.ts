/**
 * Room idle retention in Valkey. Active rooms refresh this via touchWsPresence.
 * Not an admin env — product constant (see README / privacy).
 */
export const roomStateTtlSeconds = 3600

/** Ephemeral room action-log max age (matches room Redis TTL). */
export const roomActionLogMaxAgeMs = roomStateTtlSeconds * 1000
