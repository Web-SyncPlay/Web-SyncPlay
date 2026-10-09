import { pushRelayReply } from "@/server/media/local-media-relay/chunk"
import {
  createPending,
  settlePending,
} from "@/server/media/local-media-relay/pending"
import { sendReadToSockets } from "@/server/media/local-media-relay/sockets"
import {
  LOCAL_MEDIA_RELAY_TIMEOUT_MS,
  type RelayPubSubRequest,
} from "@/server/media/local-media-relay/types"
import { getAppNodeId } from "@/server/node-id"
import { getSubscriberClient } from "@/server/redis/client"
import { keys } from "@/server/redis/keys"
import { getSocketsForUser } from "@/server/ws/registry"

const g = globalThis as typeof globalThis & {
  __webSyncPlayLocalMediaRelaySub?: boolean
}

async function handleRelayPubSubRequest(raw: string) {
  let message: RelayPubSubRequest
  try {
    message = JSON.parse(raw) as RelayPubSubRequest
  } catch {
    return
  }

  const sockets = getSocketsForUser(message.roomId, message.ownerUserId)
  if (sockets.length === 0) {
    return
  }

  const requestId = message.requestId
  if (message.originNodeId === getAppNodeId()) {
    return
  }

  const pending = createPending(requestId, LOCAL_MEDIA_RELAY_TIMEOUT_MS)
  const sent = sendReadToSockets(sockets, {
    requestId,
    localMediaId: message.localMediaId,
    start: message.start,
    end: message.end,
  })
  if (sent === 0) {
    settlePending(requestId, {
      requestId,
      ok: false,
      error: "owner_socket_closed",
    })
    return
  }

  try {
    const response = await pending
    await pushRelayReply(requestId, response)
  } catch (error) {
    await pushRelayReply(requestId, {
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : "relay_failed",
    })
  }
}

export async function ensureRelaySubscriber() {
  if (g.__webSyncPlayLocalMediaRelaySub) {
    return
  }
  g.__webSyncPlayLocalMediaRelaySub = true
  try {
    const sub = await getSubscriberClient()
    await sub.subscribe<false>(
      keys.localMediaRelayRequestChannel(),
      (message) => {
        void handleRelayPubSubRequest(String(message))
      },
    )
  } catch (error) {
    g.__webSyncPlayLocalMediaRelaySub = false
    console.warn("[local-media-relay] subscriber install failed", error)
  }
}
