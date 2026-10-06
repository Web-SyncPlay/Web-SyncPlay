/**
 * In-memory registry of File objects selected by the providing user.
 *
 * No IndexedDB / disk cache is required: a live reference from
 * `<input type="file">` (or showOpenFilePicker) is enough for File.slice()
 * range reads. Blob object URLs are only for the provider's own player.
 */

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
