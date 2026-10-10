import type { RoomPublishPort } from "@/server/ports"
import { keys } from "./keys"

export type RoomPubSubKind = "control" | "presence" | "snapshot"

type RoomPublishFanOut = Pick<RoomPublishPort, "fanOutFromPubSub">
type UserEphemeralFanOut = Pick<RoomPublishPort, "fanOutUserEphemeral">

export type PubSubDeliverResult =
  | "delivered"
  | "bad_channel"
  | "bad_payload"
  | "bad_type"
  | "skipped_echo"

const ROOM_CHANNEL_ALLOWED_TYPES: Record<RoomPubSubKind, ReadonlySet<string>> = {
  control: new Set(["room:control", "room:admission:changed"]),
  presence: new Set(["presence:batch"]),
  snapshot: new Set(["room:snapshot", "room:state"]),
}

/**
 * Parse a typed room channel message and fan out via the publish port.
 * Same-node echo skip for control/presence/snapshot lives in
 * {@link RoomPublishPort.fanOutFromPubSub}.
 * Rejects envelope types that do not belong on the channel (forged pub/sub).
 */
export function deliverRoomPubSubMessage(params: {
  channel: string
  message: string
  kind: RoomPubSubKind
  suffix: ":control" | ":presence" | ":snapshot"
  publish: RoomPublishFanOut
}): PubSubDeliverResult {
  const roomId = keys.parseRoomTypedChannel(params.channel, params.suffix)
  if (!roomId) return "bad_channel"
  try {
    const wired = JSON.parse(params.message) as {
      type: string
      payload: unknown
      originNodeId?: string
    }
    const allowed = ROOM_CHANNEL_ALLOWED_TYPES[params.kind]
    if (typeof wired.type !== "string" || !allowed.has(wired.type)) {
      console.warn(
        `[pubsub] rejected ${params.kind} message with unexpected type`,
        wired.type,
      )
      return "bad_type"
    }
    params.publish.fanOutFromPubSub(roomId, wired)
    return "delivered"
  } catch (e) {
    console.error(`[pubsub] invalid ${params.kind} message`, e)
    return "bad_payload"
  }
}

/**
 * Parse a user-ephemeral channel message. Skips same-node Redis echoes
 * before calling the publish port.
 */
export function deliverUserEphemeralPubSubMessage(params: {
  channel: string
  message: string
  localNodeId: string
  publish: UserEphemeralFanOut
}): PubSubDeliverResult {
  const parsed = keys.parseRoomUserEphemeralChannel(params.channel)
  if (!parsed) return "bad_channel"
  try {
    const wired = JSON.parse(params.message) as {
      type: string
      requestId?: string
      payload: unknown
      originNodeId?: string
    }
    if (wired.originNodeId && wired.originNodeId === params.localNodeId) {
      return "skipped_echo"
    }
    params.publish.fanOutUserEphemeral(parsed.roomId, parsed.userId, {
      type: wired.type,
      requestId: wired.requestId,
      payload: wired.payload,
    })
    return "delivered"
  } catch (e) {
    console.error("[pubsub] invalid user-ephemeral message", e)
    return "bad_payload"
  }
}
