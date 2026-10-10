/**
 * Thin dispatch facade over `@/contracts` — not a second source of truth.
 *
 * Socket dispatch and handlers should prefer importing schemas / maps from
 * `@/contracts/{schemas,room-events,s2c,types}` directly. This module only
 * re-exports those symbols (plus a few dispatch-oriented aliases) so realtime
 * call sites can share short names without duplicating wire definitions.
 *
 * - `roomMessageSchemas` / `RoomMessageSchemaMap` — re-export from room-events
 * - `joinMessageSchema` — alias of `roomJoinSchema` (join runs before the registry)
 * - `transportEnvelopeSchema` — alias of `wsEnvelopeSchema`
 * - `roomMessageEventTypes` — `Object.keys(roomMessageSchemas)` for iteration
 */
import { roomMessageSchemas } from "@/contracts/room-events"
import { roomJoinSchema, wsEnvelopeSchema } from "@/contracts/schemas"
import type { ClientEventType } from "@/contracts/room-events"

export {
  roomMessageSchemas,
  type RoomMessageSchemaMap,
} from "@/contracts/room-events"

/** Join is handled before the room-message registry. Alias of `roomJoinSchema`. */
export const joinMessageSchema = roomJoinSchema

/** Alias of `wsEnvelopeSchema` for transport-layer parsing. */
export const transportEnvelopeSchema = wsEnvelopeSchema

export const roomMessageEventTypes = Object.keys(
  roomMessageSchemas,
) as ClientEventType[]
