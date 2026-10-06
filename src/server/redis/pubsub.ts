import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import { getSubscriberClient } from "./client"
import { keys } from "./keys"

const g = globalThis as typeof globalThis & {
  __webSyncPlayPubsubInstalled?: boolean
}

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
    kind: "control" | "presence" | "snapshot",
  ) => {
    const suffix =
      kind === "control"
        ? (":control" as const)
        : kind === "presence"
          ? (":presence" as const)
          : (":snapshot" as const)
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

  await Promise.all([
    sub.pSubscribe<false>(keys.roomControlChannelPattern(), (message, channel) => {
      handle(String(message), String(channel), "control")
    }),
    sub.pSubscribe<false>(
      keys.roomPresenceChannelPattern(),
      (message, channel) => {
        handle(String(message), String(channel), "presence")
      },
    ),
    sub.pSubscribe<false>(
      keys.roomSnapshotChannelPattern(),
      (message, channel) => {
        handle(String(message), String(channel), "snapshot")
      },
    ),
  ])
}
