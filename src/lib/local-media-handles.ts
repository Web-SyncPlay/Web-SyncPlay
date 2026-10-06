/**
 * Persist File System Access API handles so local media can survive refresh.
 * Falls back gracefully when IndexedDB or FSA is unavailable.
 */

const DB_NAME = "web-syncplay-local-media"
const DB_VERSION = 1
const STORE = "handles"

export type PersistedLocalMediaHandle = {
  localMediaId: string
  roomId: string
  userId: string
  filename: string
  mimeType: string
  sizeBytes: number
  handle: FileSystemFileHandle
}

function supportsFileSystemAccess(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.showOpenFilePicker === "function" &&
    typeof indexedDB !== "undefined"
  )
}

export function canUseFileSystemAccess(): boolean {
  return supportsFileSystemAccess()
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"))
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "localMediaId" })
        store.createIndex("byRoomUser", ["roomId", "userId"], { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
  })
}

export async function persistLocalMediaHandle(
  record: PersistedLocalMediaHandle,
): Promise<void> {
  if (!supportsFileSystemAccess()) return
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite")
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error("indexedDB write failed"))
      tx.objectStore(STORE).put(record)
    })
    db.close()
  } catch (error) {
    console.warn("[local-media] failed to persist file handle", error)
  }
}

export async function deletePersistedLocalMediaHandle(
  localMediaId: string,
): Promise<void> {
  if (!supportsFileSystemAccess()) return
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite")
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error("indexedDB delete failed"))
      tx.objectStore(STORE).delete(localMediaId)
    })
    db.close()
  } catch (error) {
    console.warn("[local-media] failed to delete file handle", error)
  }
}

async function ensurePermission(
  handle: FileSystemFileHandle,
): Promise<boolean> {
  const opts = { mode: "read" as const }
  // queryPermission / requestPermission exist on FileSystemHandle in Chromium.
  const withPerm = handle as FileSystemFileHandle & {
    queryPermission?: (o: { mode: "read" }) => Promise<PermissionState>
    requestPermission?: (o: { mode: "read" }) => Promise<PermissionState>
  }
  if (typeof withPerm.queryPermission === "function") {
    let state = await withPerm.queryPermission(opts)
    if (state === "granted") return true
    if (state === "prompt" && typeof withPerm.requestPermission === "function") {
      state = await withPerm.requestPermission(opts)
      return state === "granted"
    }
    return false
  }
  // Assume readable if API missing (rare).
  try {
    await handle.getFile()
    return true
  } catch {
    return false
  }
}

/**
 * Restore handles for this room+user into the in-memory File registry.
 * Call before announceLocalMediaProviderReady on join.
 */
export async function restoreLocalMediaHandles(input: {
  roomId: string
  userId: string
  register: (localMediaId: string, file: File, mimeType?: string) => void
}): Promise<string[]> {
  if (!supportsFileSystemAccess()) return []

  const restored: string[] = []
  try {
    const db = await openDb()
    const records = await new Promise<PersistedLocalMediaHandle[]>(
      (resolve, reject) => {
        const tx = db.transaction(STORE, "readonly")
        const index = tx.objectStore(STORE).index("byRoomUser")
        const req = index.getAll([input.roomId, input.userId])
        req.onsuccess = () =>
          resolve((req.result ?? []) as PersistedLocalMediaHandle[])
        req.onerror = () =>
          reject(req.error ?? new Error("indexedDB read failed"))
      },
    )
    db.close()

    for (const record of records) {
      try {
        if (!(await ensurePermission(record.handle))) {
          await deletePersistedLocalMediaHandle(record.localMediaId)
          continue
        }
        const file = await record.handle.getFile()
        input.register(record.localMediaId, file, record.mimeType)
        restored.push(record.localMediaId)
      } catch (error) {
        console.warn("[local-media] restore handle failed", {
          localMediaId: record.localMediaId,
          error,
        })
        await deletePersistedLocalMediaHandle(record.localMediaId)
      }
    }
  } catch (error) {
    console.warn("[local-media] restore handles failed", error)
  }
  return restored
}

export async function pickLocalMediaFileWithFsa(): Promise<{
  file: File
  handle: FileSystemFileHandle
} | null> {
  if (!supportsFileSystemAccess()) return null
  const picker = window.showOpenFilePicker
  if (!picker) return null
  try {
    const handles = await picker({
      multiple: false,
      excludeAcceptAllOption: true,
      types: [
        {
          description: "Audio / video",
          accept: {
            "video/*": [".mp4", ".webm", ".mkv", ".mov"],
            "audio/*": [".mp3", ".m4a", ".ogg", ".wav", ".flac"],
          },
        },
      ],
    })
    const handle = handles[0]
    if (!handle) return null
    const file = await handle.getFile()
    return { file, handle }
  } catch (error) {
    // User cancelled — AbortError; anything else is logged by caller.
    if (error instanceof DOMException && error.name === "AbortError") {
      return null
    }
    throw error
  }
}
