/**
 * In-memory registry of File objects selected by the providing user.
 *
 * No IndexedDB / disk cache is required: a live reference from
 * `<input type="file">` (or showOpenFilePicker) is enough for File.slice()
 * range reads. Blob object URLs are only for the provider's own player.
 */

import type { TypedRoomEventSender } from "@/lib/room-events"
import type { RoomState } from "@/zod/types"

type LocalMediaRecord = {
  file: File
  objectUrl: string | null
}

const g = globalThis as typeof globalThis & {
  __webSyncPlayLocalMediaFiles?: Map<string, LocalMediaRecord>
}

function store() {
  if (!g.__webSyncPlayLocalMediaFiles) {
    g.__webSyncPlayLocalMediaFiles = new Map()
  }
  return g.__webSyncPlayLocalMediaFiles
}

export function registerLocalMediaFile(localMediaId: string, file: File) {
  const existing = store().get(localMediaId)
  if (existing?.objectUrl) {
    URL.revokeObjectURL(existing.objectUrl)
  }
  store().set(localMediaId, { file, objectUrl: null })
}

export function getLocalMediaFile(localMediaId: string) {
  return store().get(localMediaId)?.file ?? null
}

export function listLocalMediaIds() {
  return [...store().keys()]
}

export function getLocalMediaObjectUrl(localMediaId: string) {
  const record = store().get(localMediaId)
  if (!record) return null
  if (!record.objectUrl) {
    record.objectUrl = URL.createObjectURL(record.file)
  }
  return record.objectUrl
}

export function unregisterLocalMediaFile(localMediaId: string) {
  const record = store().get(localMediaId)
  if (!record) return
  if (record.objectUrl) {
    URL.revokeObjectURL(record.objectUrl)
  }
  store().delete(localMediaId)
}

/**
 * After join/reconnect: announce ready for Files we still hold, and
 * ready:false for playlist local items we own but no longer have.
 */
export function announceLocalMediaProviderReady(
  send: TypedRoomEventSender,
  roomState: RoomState | null,
  userId: string,
) {
  const held = new Set(listLocalMediaIds())
  for (const localMediaId of held) {
    send("local-media:ready", { localMediaId, ready: true })
  }

  if (!roomState) return
  for (const item of roomState.playlist) {
    if (item.sourceKind !== "local_file") continue
    if (item.localOriginUserId !== userId) continue
    const localMediaId = item.localMediaId
    if (!localMediaId || held.has(localMediaId)) continue
    send("local-media:ready", { localMediaId, ready: false })
  }
}

export function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const slice = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...slice)
  }
  return btoa(binary)
}
