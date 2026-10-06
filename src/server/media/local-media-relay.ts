import { env } from "@/env"
import {
  getOrFetchLocalMediaBlock,
  invalidateLocalMediaBlockCache,
} from "@/server/media/local-media-block-cache"
import type { LocalMediaEntry } from "@/server/media/local-media-store"
import { getCommandClient, getSubscriberClient } from "@/server/redis/client"
import { keys } from "@/server/redis/keys"
import { getSocketsForUser } from "@/server/ws/registry"
import {
  localMediaErrorFromMessage,
  type LocalMediaErrorCode,
} from "@/lib/local-media-errors"
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
  /** Raw chunk bytes from binary LMC frames (preferred; avoids base64). */
  data?: Uint8Array
  /** Legacy JSON path / Redis serialization. */
  dataBase64?: string
  error?: string
}

export class LocalMediaRelayError extends Error {
  readonly code: LocalMediaErrorCode

  constructor(code: LocalMediaErrorCode, message?: string) {
    super(message ?? code)
    this.name = "LocalMediaRelayError"
    this.code = code
  }
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
  void pushRelayReply(payload.requestId, payload)
}

/** JSON-safe payload for Redis (Uint8Array → dataBase64). */
function serializeRelayReplyPayload(payload: LocalMediaChunkPayload) {
  if (payload.data !== undefined && !payload.dataBase64) {
    return {
      requestId: payload.requestId,
      ok: payload.ok,
      dataBase64: Buffer.from(payload.data).toString("base64"),
      error: payload.error,
    }
  }
  return {
    requestId: payload.requestId,
    ok: payload.ok,
    dataBase64: payload.dataBase64,
    error: payload.error,
  }
}

async function pushRelayReply(
  requestId: string,
  payload: LocalMediaChunkPayload,
) {
  try {
    const client = await getCommandClient()
    const key = keys.localMediaRelayReply(requestId)
    await client.rPush(key, JSON.stringify(serializeRelayReplyPayload(payload)))
    await client.expire(key, 60)
  } catch (error) {
    console.warn("[local-media-relay] reply push failed", {
      requestId,
      error,
    })
  }
}

function bytesFromChunkPayload(
  payload: LocalMediaChunkPayload,
): Uint8Array | null {
  if (payload.data !== undefined) {
    return payload.data
  }
  if (payload.dataBase64) {
    return Uint8Array.from(Buffer.from(payload.dataBase64, "base64"))
  }
  return null
}

function createPending(requestId: string, timeoutMs: number) {
  return new Promise<LocalMediaChunkPayload>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingMap().delete(requestId)
      reject(new LocalMediaRelayError("provider_timeout"))
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

function throwFromChunkPayload(payload: LocalMediaChunkPayload): never {
  const code = localMediaErrorFromMessage(payload.error)
  throw new LocalMediaRelayError(code, payload.error)
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
  if (!response.ok) {
    throwFromChunkPayload(response)
  }
  const bytes = bytesFromChunkPayload(response)
  if (!bytes) {
    throwFromChunkPayload(response)
  }
  return bytes
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
  await client.publish(
    keys.localMediaRelayRequestChannel(),
    JSON.stringify(message),
  )

  const timeoutSeconds = Math.max(
    1,
    Math.ceil(env.LOCAL_MEDIA_RELAY_TIMEOUT_MS / 1000),
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
 * Fetch bytes from the providing browser (no cache). Prefer
 * {@link fetchLocalMediaAlignedBlock} for shared viewer traffic.
 */
export async function fetchLocalMediaRangeBytes(
  entry: LocalMediaEntry,
  start: number,
  end: number,
): Promise<Uint8Array> {
  if (start < 0 || end < start || start >= entry.sizeBytes) {
    throw new LocalMediaRelayError("invalid_range")
  }
  const clampedEnd = Math.min(end, entry.sizeBytes - 1)
  try {
    const local = await fetchChunkViaLocalSockets(entry, start, clampedEnd)
    if (local) {
      return local
    }
    return await fetchChunkViaRedis(entry, start, clampedEnd)
  } catch (error) {
    if (error instanceof LocalMediaRelayError) throw error
    console.error("[local-media-relay] provider fetch failed", {
      mediaId: entry.id,
      roomId: entry.roomId,
      ownerUserId: entry.ownerUserId,
      start,
      end: clampedEnd,
      error,
    })
    throw new LocalMediaRelayError(
      "relay_failed",
      error instanceof Error ? error.message : undefined,
    )
  }
}

/** Inclusive aligned block start for a byte offset. */
export function alignedBlockStart(offset: number, chunkBytes: number) {
  return Math.floor(offset / chunkBytes) * chunkBytes
}

/**
 * One cacheable provider block. Concurrent viewers coalesce via singleflight;
 * later viewers hit the process-local LRU so the sharer’s upload is ~1× per block.
 */
function relayChunkBytes() {
  const raw = env.LOCAL_MEDIA_RELAY_CHUNK_BYTES
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0
    ? raw
    : 256 * 1024
}

export async function fetchLocalMediaAlignedBlock(
  entry: LocalMediaEntry,
  blockStart: number,
): Promise<{ bytes: Uint8Array; cacheHit: boolean }> {
  const chunkBytes = relayChunkBytes()
  const aligned = alignedBlockStart(blockStart, chunkBytes)
  if (aligned !== blockStart) {
    throw new LocalMediaRelayError(
      "invalid_range",
      `blockStart must be aligned to ${chunkBytes}`,
    )
  }
  const blockEnd = Math.min(aligned + chunkBytes - 1, entry.sizeBytes - 1)

  return await getOrFetchLocalMediaBlock({
    mediaId: entry.id,
    blockStart: aligned,
    fetch: () => fetchLocalMediaRangeBytes(entry, aligned, blockEnd),
  })
}

/**
 * Stream an inclusive byte range using aligned cached blocks so overlapping
 * viewer Ranges share provider uploads.
 */
export function createLocalMediaByteStream(
  entry: LocalMediaEntry,
  start: number,
  end: number,
): ReadableStream<Uint8Array> {
  const chunkBytes = relayChunkBytes()
  let offset = start
  const last = Math.min(end, entry.sizeBytes - 1)

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (offset > last) {
        controller.close()
        return
      }
      const blockStart = alignedBlockStart(offset, chunkBytes)
      try {
        const { bytes, cacheHit } = await fetchLocalMediaAlignedBlock(
          entry,
          blockStart,
        )
        const blockEnd = blockStart + bytes.byteLength - 1
        const sliceFrom = offset - blockStart
        const sliceTo = Math.min(last, blockEnd) - blockStart + 1
        const slice = bytes.subarray(sliceFrom, sliceTo)
        offset = blockStart + sliceTo
        if (!cacheHit) {
          console.info("[local-media-relay] block fetched from provider", {
            mediaId: entry.id,
            blockStart,
            bytes: bytes.byteLength,
          })
        }
        controller.enqueue(slice)
      } catch (error) {
        controller.error(error)
      }
    },
    cancel() {
      offset = last + 1
    },
  })
}

export { invalidateLocalMediaBlockCache }
