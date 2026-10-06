import { env } from "@/env"
import type { LocalMediaEntry } from "@/server/media/local-media-store"
import { getCommandClient, getSubscriberClient } from "@/server/redis/client"
import { keys } from "@/server/redis/keys"
import { getSocketsForUser } from "@/server/ws/registry"
import { randomUUID } from "node:crypto"
import type { WebSocket } from "ws"

export type LocalMediaReadRequest = {
  requestId: string
  localMediaId: string
  start: number
  end: number
}

export type LocalMediaChunkPayload = {
  requestId: string
  ok: boolean
  dataBase64?: string
  error?: string
}

type PendingLocal = {
  resolve: (payload: LocalMediaChunkPayload) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type RelayPubSubRequest = {
  requestId: string
  roomId: string
  ownerUserId: string
  localMediaId: string
  start: number
  end: number
  originNodeId: string
}

const RELAY_NODE_ID = randomUUID()

const g = globalThis as typeof globalThis & {
  __webSyncPlayLocalMediaPending?: Map<string, PendingLocal>
  __webSyncPlayLocalMediaRelaySub?: boolean
}

function pendingMap() {
  if (!g.__webSyncPlayLocalMediaPending) {
    g.__webSyncPlayLocalMediaPending = new Map()
  }
  return g.__webSyncPlayLocalMediaPending
}

function settlePending(requestId: string, payload: LocalMediaChunkPayload) {
  const pending = pendingMap().get(requestId)
  if (!pending) return false
  pendingMap().delete(requestId)
  clearTimeout(pending.timer)
  pending.resolve(payload)
  return true
}

export function resolveLocalMediaChunk(payload: LocalMediaChunkPayload) {
  if (!payload.requestId) return
  if (settlePending(payload.requestId, payload)) {
    return
  }
  // Chunk arrived on a node that forwarded a cross-instance request —
  // push onto the reply list for the waiting HTTP handler.
  void pushRelayReply(payload.requestId, payload)
}

async function pushRelayReply(
  requestId: string,
  payload: LocalMediaChunkPayload,
) {
  try {
    const client = await getCommandClient()
    const key = keys.localMediaRelayReply(requestId)
    await client.rPush(key, JSON.stringify(payload))
    await client.expire(key, 60)
  } catch (error) {
    console.warn("[local-media-relay] reply push failed", error)
  }
}

function createPending(requestId: string, timeoutMs: number) {
  return new Promise<LocalMediaChunkPayload>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingMap().delete(requestId)
      reject(new Error("Local media provider timed out"))
    }, timeoutMs)
    pendingMap().set(requestId, { resolve, reject, timer })
  })
}

function sendReadToSockets(
  sockets: Iterable<WebSocket>,
  request: LocalMediaReadRequest,
) {
  const raw = JSON.stringify({
    type: "local-media:read",
    payload: request,
  })
  let sent = 0
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) {
      ws.send(raw)
      sent += 1
    }
  }
  return sent
}

async function fetchChunkViaLocalSockets(
  entry: LocalMediaEntry,
  start: number,
  end: number,
): Promise<Uint8Array | null> {
  const sockets = getSocketsForUser(entry.roomId, entry.ownerUserId)
  if (sockets.length === 0) {
    return null
  }

  const requestId = randomUUID()
  const pending = createPending(requestId, env.LOCAL_MEDIA_RELAY_TIMEOUT_MS)
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
  if (!response.ok || !response.dataBase64) {
    throw new Error(response.error ?? "Local media provider unavailable")
  }
  return Uint8Array.from(Buffer.from(response.dataBase64, "base64"))
}

async function fetchChunkViaRedis(
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
    originNodeId: RELAY_NODE_ID,
  }
  await client.publish(keys.localMediaRelayRequestChannel(), JSON.stringify(message))

  const timeoutSeconds = Math.max(
    1,
    Math.ceil(env.LOCAL_MEDIA_RELAY_TIMEOUT_MS / 1000),
  )
  const result = await client.blPop(replyKey, timeoutSeconds)
  if (!result) {
    throw new Error("Local media provider timed out")
  }

  const payload = JSON.parse(result.element) as LocalMediaChunkPayload
  if (!payload.ok || !payload.dataBase64) {
    throw new Error(payload.error ?? "Local media provider unavailable")
  }
  return Uint8Array.from(Buffer.from(payload.dataBase64, "base64"))
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
  // Origin node already tried local sockets; only foreign nodes should answer.
  if (message.originNodeId === RELAY_NODE_ID) {
    return
  }

  const pending = createPending(requestId, env.LOCAL_MEDIA_RELAY_TIMEOUT_MS)
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

/**
 * Fetch a single inclusive byte range from the providing user's browser
 * (local WS first, Redis pub/sub relay for multi-instance).
 */
export async function fetchLocalMediaRangeBytes(
  entry: LocalMediaEntry,
  start: number,
  end: number,
): Promise<Uint8Array> {
  if (start < 0 || end < start || start >= entry.sizeBytes) {
    throw new Error("Invalid byte range")
  }
  const clampedEnd = Math.min(end, entry.sizeBytes - 1)
  const local = await fetchChunkViaLocalSockets(entry, start, clampedEnd)
  if (local) {
    return local
  }
  return await fetchChunkViaRedis(entry, start, clampedEnd)
}

/**
 * Stream an inclusive byte range by chaining provider chunk fetches.
 * Keeps each WebSocket JSON payload bounded by LOCAL_MEDIA_RELAY_CHUNK_BYTES.
 */
export function createLocalMediaByteStream(
  entry: LocalMediaEntry,
  start: number,
  end: number,
): ReadableStream<Uint8Array> {
  const chunkBytes = env.LOCAL_MEDIA_RELAY_CHUNK_BYTES
  let offset = start
  const last = Math.min(end, entry.sizeBytes - 1)

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (offset > last) {
        controller.close()
        return
      }
      const chunkEnd = Math.min(offset + chunkBytes - 1, last)
      try {
        const bytes = await fetchLocalMediaRangeBytes(entry, offset, chunkEnd)
        offset = chunkEnd + 1
        controller.enqueue(bytes)
      } catch (error) {
        controller.error(error)
      }
    },
    cancel() {
      offset = last + 1
    },
  })
}
