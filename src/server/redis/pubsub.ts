import {
  BROADCAST_NODE_ID,
  getRoomBroadcastBus,
} from "@/server/realtime/broadcast/room-broadcast-bus"
import { getSubscriberClient } from "./client"
import { keys } from "./keys"

const g = globalThis as typeof globalThis & {
  __webSyncPlayPubsubInstalled?: boolean
}

type RoomPubSubKind = "control" | "presence" | "snapshot"

const ROOM_PUBSUB_SUBSCRIPTIONS: Array<{
  kind: RoomPubSubKind
  pattern: () => string
  suffix: ":control" | ":presence" | ":snapshot"
}> = [
  {
    kind: "control",
    pattern: keys.roomControlChannelPattern,
    suffix: ":control",
  },
  {
    kind: "presence",
    pattern: keys.roomPresenceChannelPattern,
    suffix: ":presence",
  },
  {
    kind: "snapshot",
    pattern: keys.roomSnapshotChannelPattern,
    suffix: ":snapshot",
  },
]

/**
 * Subscribe to typed room channels. Fan-out is immediate (coalesce happens
 * only on the mutating node before PUBLISH). Same-node echoes are skipped.
 */
export async function subscribeRoomUpdates() {
  if (g.__webSyncPlayPubsubInstalled) {
    return
  }
  g.__webSyncPlayPubsubInstalled = true

  const sub = await getSubscriberClient()
  const bus = getRoomBroadcastBus()

  const handle = (
    message: string,
    channel: string,
    kind: RoomPubSubKind,
    suffix: ":control" | ":presence" | ":snapshot",
  ) => {
    const roomId = keys.parseRoomTypedChannel(String(channel), suffix)
    if (!roomId) return
    try {
      const wired = JSON.parse(message) as {
        type: string
        payload: unknown
        originNodeId?: string
      }
      bus.fanOutFromPubSub(roomId, wired as never)
    } catch (e) {
      console.error(`[pubsub] invalid ${kind} message`, e)
    }
  }

  const handleUserEphemeral = (message: string, channel: string) => {
    const parsed = keys.parseRoomUserEphemeralChannel(String(channel))
    if (!parsed) return
    try {
      const wired = JSON.parse(message) as {
        type: string
        requestId?: string
        payload: unknown
        originNodeId?: string
      }
      if (wired.originNodeId && wired.originNodeId === BROADCAST_NODE_ID) {
        return
      }
      const { originNodeId: _o, ...envelope } = wired
      bus.fanOutUserEphemeral(parsed.roomId, parsed.userId, envelope)
    } catch (e) {
      console.error("[pubsub] invalid user-ephemeral message", e)
    }
  }

  await Promise.all([
    ...ROOM_PUBSUB_SUBSCRIPTIONS.map(({ kind, pattern, suffix }) =>
      sub.pSubscribe<false>(pattern(), (message, channel) => {
        handle(String(message), String(channel), kind, suffix)
      }),
    ),
    sub.pSubscribe<false>(
      keys.roomUserEphemeralChannelPattern(),
      (message, channel) => {
        handleUserEphemeral(String(message), String(channel))
      },
    ),
  ])
}
