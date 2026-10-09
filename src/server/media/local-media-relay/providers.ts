import { env } from "@/env"
import {
  bytesFromChunkPayload,
  throwFromChunkPayload,
} from "@/server/media/local-media-relay/chunk"
import {
  getLocalMediaNode,
  isLocalMediaInternalConfigured,
} from "@/server/media/local-media-node-registry"
import {
  createPending,
  settlePending,
} from "@/server/media/local-media-relay/pending"
import { sendReadToSockets } from "@/server/media/local-media-relay/sockets"
import { ensureRelaySubscriber } from "@/server/media/local-media-relay/subscriber"
import {
  LOCAL_MEDIA_RELAY_TIMEOUT_MS,
  LocalMediaRelayError,
  type LocalMediaChunkPayload,
  type RelayPubSubRequest,
} from "@/server/media/local-media-relay/types"
import type { LocalMediaEntry } from "@/server/media/local-media-store"
import { getAppNodeId } from "@/server/node-id"
import { getCommandClient } from "@/server/redis/client"
import { keys } from "@/server/redis/keys"
import { getSocketsForUser } from "@/server/ws/registry"
import { randomUUID } from "node:crypto"

export async function fetchChunkViaLocalSockets(
  entry: LocalMediaEntry,
  start: number,
  end: number,
): Promise<Uint8Array | null> {
  const sockets = getSocketsForUser(entry.roomId, entry.ownerUserId)
  if (sockets.length === 0) {
    return null
  }

  const requestId = randomUUID()
  const pending = createPending(requestId, LOCAL_MEDIA_RELAY_TIMEOUT_MS)
  const sent = sendReadToSockets(sockets, {
    requestId,
    localMediaId: entry.id,
    start,
    end,
  })
  if (sent === 0) {
    settlePending(requestId, {
      requestId,
      ok: false,
      error: "owner_socket_closed",
    })
    return null
  }

  const response = await pending
  if (!response.ok) {
    throwFromChunkPayload(response)
  }
  const bytes = bytesFromChunkPayload(response)
  if (!bytes) {
    throwFromChunkPayload(response)
  }
  return bytes
}

/**
 * Prefer the node that holds the provider WebSocket for cache misses.
 * Returns null when affinity is unavailable so callers fall through to pub/sub.
 */
export async function fetchChunkViaInternalHttp(
  entry: LocalMediaEntry,
  start: number,
  end: number,
): Promise<Uint8Array | null> {
  if (!isLocalMediaInternalConfigured()) {
    return null
  }
  const holderNodeId = entry.providerNodeId
  if (!holderNodeId || holderNodeId === getAppNodeId()) {
    return null
  }

  const secret = env.LOCAL_MEDIA_INTERNAL_SECRET?.trim()
  if (!secret) {
    return null
  }

  const holder = await getLocalMediaNode(holderNodeId)
  if (!holder?.baseUrl) {
    return null
  }

  const url = `${holder.baseUrl}/api/media/local/internal/${encodeURIComponent(entry.id)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LOCAL_MEDIA_RELAY_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Range: `bytes=${start}-${end}`,
        "X-Local-Media-Internal": secret,
      },
      signal: controller.signal,
    })
    if (!response.ok && response.status !== 206) {
      console.warn("[local-media-relay] internal fetch non-OK", {
        mediaId: entry.id,
        holderNodeId,
        status: response.status,
      })
      return null
    }
    const buffer = new Uint8Array(await response.arrayBuffer())
    if (buffer.byteLength === 0) {
      return null
    }
    return buffer
  } catch (error) {
    console.warn("[local-media-relay] internal fetch failed", {
      mediaId: entry.id,
      holderNodeId,
      error,
    })
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchChunkViaRedis(
  entry: LocalMediaEntry,
  start: number,
  end: number,
): Promise<Uint8Array> {
  await ensureRelaySubscriber()

  const requestId = randomUUID()
  const client = await getCommandClient()
  const replyKey = keys.localMediaRelayReply(requestId)
  await client.del(replyKey)

  const message: RelayPubSubRequest = {
    requestId,
    roomId: entry.roomId,
    ownerUserId: entry.ownerUserId,
    localMediaId: entry.id,
    start,
    end,
    originNodeId: getAppNodeId(),
  }
  await client.publish(
    keys.localMediaRelayRequestChannel(),
    JSON.stringify(message),
  )

  const timeoutSeconds = Math.max(
    1,
    Math.ceil(LOCAL_MEDIA_RELAY_TIMEOUT_MS / 1000),
  )
  const result = await client.blPop(replyKey, timeoutSeconds)
  if (!result) {
    throw new LocalMediaRelayError("provider_timeout")
  }

  const payload = JSON.parse(result.element) as LocalMediaChunkPayload
  if (!payload.ok) {
    throwFromChunkPayload(payload)
  }
  const bytes = bytesFromChunkPayload(payload)
  if (!bytes) {
    throwFromChunkPayload(payload)
  }
  return bytes
}
