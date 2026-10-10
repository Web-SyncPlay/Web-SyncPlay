import { roomMessageSchemas } from "@/contracts/room-events"
import { roomJoinSchema, wsEnvelopeSchema } from "@/contracts/schemas"
import type { ClientEventType } from "@/contracts/room-events"

export {
  roomMessageSchemas,
  type RoomMessageSchemaMap,
} from "@/contracts/room-events"

/** Join is handled before the room-message registry. */
export const joinMessageSchema = roomJoinSchema

export const transportEnvelopeSchema = wsEnvelopeSchema

export const roomMessageEventTypes = Object.keys(
  roomMessageSchemas,
) as ClientEventType[]
