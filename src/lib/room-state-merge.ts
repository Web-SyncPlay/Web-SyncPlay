import type {
  PresenceBatchPayload,
  PresencePatch,
  RoomControlPayload,
  RoomSnapshotPayload,
  RoomState,
} from "@/zod/types"

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
      connected:
        typeof patch.connected === "boolean"
          ? patch.connected
          : existing.connected,
      lastSeenAt:
        typeof patch.lastSeenAt === "number"
          ? patch.lastSeenAt
          : existing.lastSeenAt,
      disconnectedAt:
        typeof patch.disconnectedAt === "number"
          ? patch.disconnectedAt
          : existing.disconnectedAt,
      username:
        typeof patch.username === "string" ? patch.username : existing.username,
      avatarStyle:
        typeof patch.avatarStyle === "string"
          ? patch.avatarStyle
          : existing.avatarStyle,
      localPlayback: patch.localPlayback ?? existing.localPlayback,
    }
    changed = true
  }
  return changed ? next : prev
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
    playlist: prev.playlist,
    participants: prev.participants,
    history: prev.history,
    actionLog: prev.actionLog,
    roomSecurity: prev.roomSecurity,
    playback: payload.playback,
    currentIndex: payload.currentIndex,
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
    playlist: prev.playlist,
    playback: prev.playback,
    history: prev.history,
    actionLog: prev.actionLog,
    roomSecurity: prev.roomSecurity,
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
    playlist: payload.playlist,
    participants: payload.participants,
    history: payload.history,
    actionLog: payload.actionLog,
    roomSecurity: payload.roomSecurity,
    playback,
    currentIndex: applyPlayback ? payload.currentIndex : prev.currentIndex,
    generation: Math.max(localGen, payload.generation ?? 0),
    structuralRevision: Math.max(
      prev.structuralRevision ?? 0,
      payload.structuralRevision ?? 0,
    ),
  }
}
