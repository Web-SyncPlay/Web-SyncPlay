import type {
  PresencePatch,
  RoomSnapshotPayload,
  RoomState,
} from "@/contracts/types"
import type { RoomStateStorePort } from "@/server/ports"
import { peekPresenceRevision } from "@/server/realtime/broadcast/presence-seq"
import { sanitizeRoomStateForClient } from "@/server/realtime/services/room-security"

/** In-process snapshot cache TTL — short enough to avoid stale presence overlays. */
const SNAPSHOT_CACHE_TTL_MS = 250

type SnapshotCacheEntry = {
  generation: number
  structuralRevision: number
  presenceRevision: number
  payload: RoomSnapshotPayload
  cachedAt: number
}

const g = globalThis as typeof globalThis & {
  __webSyncPlaySnapshotCache?: Map<string, SnapshotCacheEntry>
}

function snapshotCache(): Map<string, SnapshotCacheEntry> {
  g.__webSyncPlaySnapshotCache ??= new Map()
  return g.__webSyncPlaySnapshotCache
}

export function structuralHash(state: RoomState): string {
  const participants = Object.fromEntries(
    Object.entries(state.participants).map(([id, p]) => [
      id,
      {
        username: p.username,
        avatarStyle: p.avatarStyle,
        role: p.role,
        connected: p.connected,
        viewerMedia: p.viewerMedia,
      },
    ]),
  )
  return JSON.stringify({
    structuralRevision: state.structuralRevision,
    ownerId: state.ownerId,
    playlist: state.playlist,
    currentIndex: state.currentIndex,
    roomSecurity: {
      joinPasswordEnabled: state.roomSecurity.joinPasswordEnabled,
      admissionVersion: state.roomSecurity.admissionVersion,
      defaultJoinRole: state.roomSecurity.defaultJoinRole,
    },
    actionLog: state.actionLog,
    participants,
  })
}

export function applyPresenceOverlay(
  state: RoomState,
  overlay: Record<string, PresencePatch>,
) {
  for (const [userId, patch] of Object.entries(overlay)) {
    const participant = state.participants[userId]
    if (!participant) continue
    if (patch.localPlayback) participant.localPlayback = patch.localPlayback
    if (typeof patch.connected === "boolean") {
      participant.connected = patch.connected
    }
    if (typeof patch.lastSeenAt === "number") {
      participant.lastSeenAt = patch.lastSeenAt
    }
    if (typeof patch.disconnectedAt === "number") {
      participant.disconnectedAt = patch.disconnectedAt
    }
    if (typeof patch.username === "string") {
      participant.username = patch.username
    }
    if (typeof patch.avatarStyle === "string") {
      participant.avatarStyle = patch.avatarStyle
    }
  }
}

/** Drop cached snapshot for a room (or all rooms when roomId omitted). */
export function invalidateSnapshotCache(roomId?: string): void {
  const cache = snapshotCache()
  if (!roomId) {
    cache.clear()
    return
  }
  cache.delete(roomId)
}

/** Test helper. */
export function resetSnapshotCacheForTests(): void {
  snapshotCache().clear()
}

export async function buildSanitizedSnapshot(
  store: RoomStateStorePort | null,
  roomId: string,
): Promise<RoomSnapshotPayload | null> {
  if (!store || typeof store.get !== "function") return null

  // Always load generation/structural + presenceRev. Presence alone is not
  // enough: join bumps structure before a presence batch is flushed, and the
  // joiner snapshot must not reuse a pre-join cache entry.
  const [state, presenceRevision] = await Promise.all([
    store.get(roomId),
    peekPresenceRevision(roomId),
  ])
  if (!state) return null

  const generation = state.generation ?? 0
  const structuralRevision = state.structuralRevision ?? 0
  const cache = snapshotCache()
  const cached = cache.get(roomId)
  if (
    cached &&
    Date.now() - cached.cachedAt < SNAPSHOT_CACHE_TTL_MS &&
    presenceRevision === cached.presenceRevision &&
    generation === cached.generation &&
    structuralRevision === cached.structuralRevision
  ) {
    return cached.payload
  }

  const overlay = await store.getPresenceDataAll(roomId)
  applyPresenceOverlay(state, overlay)

  const payload = sanitizeRoomStateForClient({
    ...state,
    presenceRevision,
    playback: { ...state.playback, seekPreview: undefined },
  })

  cache.set(roomId, {
    generation,
    structuralRevision,
    presenceRevision,
    payload,
    cachedAt: Date.now(),
  })

  return payload
}
