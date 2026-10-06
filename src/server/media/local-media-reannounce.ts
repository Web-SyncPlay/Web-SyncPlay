import { getAppNodeId } from "@/server/node-id"
import { getCommandClient, getSubscriberClient } from "@/server/redis/client"
import { keys } from "@/server/redis/keys"
import { getSocketsForUser } from "@/server/ws/registry"

type ReannounceMessage = {
  roomId: string
  userId: string
  originNodeId: string
}

const g = globalThis as typeof globalThis & {
  __webSyncPlayLocalMediaReannounceSub?: boolean
}

function deliverReannounce(roomId: string, userId: string) {
  const raw = JSON.stringify({
    type: "local-media:reannounce",
    payload: {},
  })
  for (const socket of getSocketsForUser(roomId, userId)) {
    if (socket.readyState === socket.OPEN) {
      socket.send(raw)
    }
  }
}

export async function publishLocalMediaReannounce(
  roomId: string,
  userId: string,
): Promise<void> {
  // Always deliver locally first (covers single-node and Redis blips).
  deliverReannounce(roomId, userId)

  try {
    const client = await getCommandClient()
    const message: ReannounceMessage = {
      roomId,
      userId,
      originNodeId: getAppNodeId(),
    }
    await client.publish(
      keys.localMediaReannounceChannel(),
      JSON.stringify(message),
    )
  } catch (error) {
    console.warn("[local-media] reannounce publish failed", error)
  }
}

export async function ensureLocalMediaReannounceSubscriber(): Promise<void> {
  if (g.__webSyncPlayLocalMediaReannounceSub) {
    return
  }
  g.__webSyncPlayLocalMediaReannounceSub = true
  try {
    const sub = await getSubscriberClient()
    await sub.subscribe<false>(
      keys.localMediaReannounceChannel(),
      (raw) => {
        let message: ReannounceMessage
        try {
          message = JSON.parse(String(raw)) as ReannounceMessage
        } catch {
          return
        }
        if (!message.roomId || !message.userId) return
        if (message.originNodeId === getAppNodeId()) return
        deliverReannounce(message.roomId, message.userId)
      },
    )
  } catch (error) {
    g.__webSyncPlayLocalMediaReannounceSub = false
    console.warn("[local-media] reannounce subscriber install failed", error)
  }
}
