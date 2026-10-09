import type {
  PresenceBatchPayload,
  PresencePatch,
  RoomControlPayload,
  RoomSnapshotPayload,
  RoomState,
} from "@/zod/types"

function pickDefined<T>(
  patchValue: T | undefined,
  existing: T,
): T {
  return patchValue !== undefined ? patchValue : existing
}

function mergeParticipantPresence(
  prev: RoomState["participants"],
  patches: Record<string, PresencePatch>,
): RoomState["participants"] {
  let changed = false
  const next = { ...prev }
  for (const [userId, patch] of Object.entries(patches)) {
    const existing = next[userId]
    if (!existing) continue
    next[userId] = {
      ...existing,
      connected: pickDefined(patch.connected, existing.connected),
      lastSeenAt: pickDefined(patch.lastSeenAt, existing.lastSeenAt),
      disconnectedAt: pickDefined(patch.disconnectedAt, existing.disconnectedAt),
      username: pickDefined(patch.username, existing.username),
      avatarStyle: pickDefined(patch.avatarStyle, existing.avatarStyle),
      localPlayback: patch.localPlayback ?? existing.localPlayback,
    }
    changed = true
  }
  return changed ? next : prev
}

/**
 * Control patches carry `currentIndex` without the playlist. When the playlist
 * is still stale (snapshot pending), a remapped index can point at the wrong
 * neighbor. Prefer the stable `playback.mediaId` identity when they disagree.
 */
function reconcileControlCurrentIndex(
  prev: RoomState,
  payload: RoomControlPayload,
): number {
  const mediaId = payload.playback.mediaId
  if (!mediaId) {
    return payload.currentIndex
  }
  if (prev.playlist[payload.currentIndex]?.id === mediaId) {
    return payload.currentIndex
  }
  const byMediaId = prev.playlist.findIndex((item) => item.id === mediaId)
  return byMediaId >= 0 ? byMediaId : prev.currentIndex
}

export function applyRoomControl(
  prev: RoomState | null,
  payload: RoomControlPayload,
): RoomState | null {
  if (!prev) return prev
  const localGen = prev.generation ?? 0
  if (payload.generation < localGen) {
    return prev
  }
  return {
    ...prev,
    playback: payload.playback,
    currentIndex: reconcileControlCurrentIndex(prev, payload),
    updatedAt: payload.updatedAt,
    generation: payload.generation,
  }
}

export function applyPresenceBatch(
  prev: RoomState | null,
  payload: PresenceBatchPayload,
): RoomState | null {
  if (!prev) return prev
  const participants = mergeParticipantPresence(
    prev.participants,
    payload.participants,
  )
  if (participants === prev.participants) {
    return prev
  }
  return {
    ...prev,
    participants,
  }
}

export function applyRoomSnapshot(
  prev: RoomState | null,
  payload: RoomSnapshotPayload,
): RoomState {
  if (!prev) {
    return payload
  }

  const localGen = prev.generation ?? 0
  const applyPlayback = payload.generation >= localGen

  // Preserve ephemeral seek preview from a newer/equal control patch.
  let playback = applyPlayback ? payload.playback : prev.playback
  if (
    applyPlayback &&
    prev.playback.seekPreview?.active &&
    !payload.playback.seekPreview?.active &&
    (prev.generation ?? 0) >= payload.generation
  ) {
    playback = {
      ...playback,
      seekPreview: prev.playback.seekPreview,
    }
  }

  return {
    ...payload,
    playback,
    currentIndex: applyPlayback ? payload.currentIndex : prev.currentIndex,
    generation: Math.max(localGen, payload.generation ?? 0),
    structuralRevision: Math.max(
      prev.structuralRevision ?? 0,
      payload.structuralRevision ?? 0,
    ),
  }
}
