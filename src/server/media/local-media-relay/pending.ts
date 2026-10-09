import { pushRelayReply } from "@/server/media/local-media-relay/chunk"
import {
  LocalMediaRelayError,
  type LocalMediaChunkPayload,
  type PendingLocal,
} from "@/server/media/local-media-relay/types"

const g = globalThis as typeof globalThis & {
  __webSyncPlayLocalMediaPending?: Map<string, PendingLocal>
}

export function pendingMap() {
  if (!g.__webSyncPlayLocalMediaPending) {
    g.__webSyncPlayLocalMediaPending = new Map()
  }
  return g.__webSyncPlayLocalMediaPending
}

export function settlePending(
  requestId: string,
  payload: LocalMediaChunkPayload,
) {
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

export function createPending(requestId: string, timeoutMs: number) {
  return new Promise<LocalMediaChunkPayload>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingMap().delete(requestId)
      reject(new LocalMediaRelayError("provider_timeout"))
    }, timeoutMs)
    pendingMap().set(requestId, { resolve, reject, timer })
  })
}
