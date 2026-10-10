import { getCommandClient } from "@/server/redis/client"
import { keys } from "@/server/redis/keys"
import type {
  AdmissionChangedPayload,
  RoomControlPayload,
} from "@/contracts/types"
import type {
  AdmissionChangedEnvelope,
  ControlEnvelope,
  RoomBroadcastEnvelope,
} from "./channels"
import { forceRejoinNonOwners, sendRawToRoom } from "./bus-fanout"
import { BROADCAST_NODE_ID } from "./node-id"

export type PublishCapture = {
  roomId: string
  envelope: RoomBroadcastEnvelope
}

type WiredEnvelope = RoomBroadcastEnvelope & { originNodeId?: string }

export async function publishControlEnvelope(options: {
  roomId: string
  payload: RoomControlPayload
  captureOnly: boolean
  captured: PublishCapture[]
}) {
  const envelope: ControlEnvelope = {
    type: "room:control",
    payload: options.payload,
  }
  await publishTyped({
    roomId: options.roomId,
    channel: keys.roomControlChannel(options.roomId),
    envelope,
    captureOnly: options.captureOnly,
    captured: options.captured,
  })
}

export async function publishAdmissionChangedEnvelope(options: {
  roomId: string
  payload: AdmissionChangedPayload
  captureOnly: boolean
  captured: PublishCapture[]
}) {
  const envelope: AdmissionChangedEnvelope = {
    type: "room:admission:changed",
    payload: options.payload,
  }
  options.captured.push({ roomId: options.roomId, envelope })
  forceRejoinNonOwners(options.roomId, options.payload.ownerId, envelope)

  if (options.captureOnly) {
    return
  }

  try {
    const wired: WiredEnvelope = {
      ...envelope,
      originNodeId: BROADCAST_NODE_ID,
    }
    const client = await getCommandClient()
    await client.publish(
      keys.roomControlChannel(options.roomId),
      JSON.stringify(wired),
    )
  } catch (error) {
    console.warn("[broadcast] admission-changed redis publish failed", error)
  }
}

export async function publishUserEphemeralEnvelope(options: {
  roomId: string
  targetUserId: string
  envelope: { type: string; requestId?: string; payload: unknown }
  captureOnly: boolean
  fanOutLocal: (
    roomId: string,
    targetUserId: string,
    envelope: { type: string; requestId?: string; payload: unknown },
  ) => void
}) {
  options.fanOutLocal(
    options.roomId,
    options.targetUserId,
    options.envelope,
  )

  if (options.captureOnly) {
    return
  }

  try {
    const wired = {
      ...options.envelope,
      originNodeId: BROADCAST_NODE_ID,
    }
    const client = await getCommandClient()
    await client.publish(
      keys.roomUserEphemeralChannel(options.roomId, options.targetUserId),
      JSON.stringify(wired),
    )
  } catch (error) {
    console.warn("[broadcast] user-ephemeral redis publish failed", error)
  }
}

export async function publishTyped(options: {
  roomId: string
  channel: string
  envelope: RoomBroadcastEnvelope
  captureOnly: boolean
  captured: PublishCapture[]
}) {
  options.captured.push({ roomId: options.roomId, envelope: options.envelope })
  const rawLocal = JSON.stringify(options.envelope)
  sendRawToRoom(options.roomId, rawLocal)

  if (options.captureOnly) {
    return
  }

  try {
    const wired: WiredEnvelope = {
      ...options.envelope,
      originNodeId: BROADCAST_NODE_ID,
    }
    const client = await getCommandClient()
    await client.publish(options.channel, JSON.stringify(wired))
  } catch (error) {
    // Unit tests / Redis blips: local fan-out already happened.
    console.warn("[broadcast] redis publish failed", error)
  }
}
