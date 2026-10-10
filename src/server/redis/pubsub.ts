import { getAppNodeId } from "@/server/node-id"
import { getRoomPublishPort } from "@/server/ports"
import { getSubscriberClient } from "./client"
import { keys } from "./keys"
import {
  deliverRoomPubSubMessage,
  deliverUserEphemeralPubSubMessage,
  type RoomPubSubKind,
} from "./pubsub-handlers"

const g = globalThis as typeof globalThis & {
  __webSyncPlayPubsubInstalled?: boolean
}

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

  const publish = getRoomPublishPort()
  if (!publish) {
    console.error(
      "[pubsub] RoomPublishPort not configured; room fan-out deferred",
    )
    return
  }

  g.__webSyncPlayPubsubInstalled = true

  const sub = await getSubscriberClient()
  const localNodeId = getAppNodeId()

  await Promise.all([
    ...ROOM_PUBSUB_SUBSCRIPTIONS.map(({ kind, pattern, suffix }) =>
      sub.pSubscribe<false>(pattern(), (message, channel) => {
        const port = getRoomPublishPort() ?? publish
        deliverRoomPubSubMessage({
          channel: String(channel),
          message: String(message),
          kind,
          suffix,
          publish: port,
        })
      }),
    ),
    sub.pSubscribe<false>(
      keys.roomUserEphemeralChannelPattern(),
      (message, channel) => {
        const port = getRoomPublishPort() ?? publish
        deliverUserEphemeralPubSubMessage({
          channel: String(channel),
          message: String(message),
          localNodeId,
          publish: port,
        })
      },
    ),
  ])
}
