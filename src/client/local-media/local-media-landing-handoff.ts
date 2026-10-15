/**
 * Short-lived in-memory handoff of a File picked on the landing page
 * into a newly created room (so the user does not re-select the file).
 *
 * Also carries create-time `skipDefaultMedia` so we never need `?local=1`
 * in the URL (searchParams changes remount the room client and drop the WS).
 */

export type LandingLocalMediaHandoff = {
  file: File
  handle?: FileSystemFileHandle
  createdAt: number
}

const HANDOFF_TTL_MS = 5 * 60 * 1000

type PendingLandingHandoff = {
  roomId: string
  skipDefaultMedia: boolean
  handoff: LandingLocalMediaHandoff
}

let pending: PendingLandingHandoff | null = null

function isPendingFresh(entry: PendingLandingHandoff, roomId: string): boolean {
  if (entry.roomId !== roomId) return false
  if (Date.now() - entry.handoff.createdAt > HANDOFF_TTL_MS) return false
  return true
}

export function stashLandingLocalMediaHandoff(
  roomId: string,
  file: File,
  handle?: FileSystemFileHandle,
): void {
  pending = {
    roomId,
    skipDefaultMedia: true,
    handoff: {
      file,
      ...(handle ? { handle } : {}),
      createdAt: Date.now(),
    },
  }
}

/**
 * Create-time empty-playlist flag for this room. Does **not** consume the File.
 * Safe to call from RoomClient mount before playlist controls take the file.
 */
export function peekLandingSkipDefaultMedia(roomId: string): boolean {
  if (!pending) return false
  if (!isPendingFresh(pending, roomId)) {
    pending = null
    return false
  }
  return pending.skipDefaultMedia
}

/** Consume a File handoff for `roomId` once. Expired or mismatched entries are cleared. */
export function takeLandingLocalMediaHandoff(
  roomId: string,
): LandingLocalMediaHandoff | null {
  if (!pending) return null
  const entry = pending
  pending = null
  if (!isPendingFresh(entry, roomId)) return null
  return entry.handoff
}

/** Test-only reset. */
export function clearLandingLocalMediaHandoff(): void {
  pending = null
}
