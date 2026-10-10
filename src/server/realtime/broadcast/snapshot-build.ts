import type { RoomStateStorePort } from "@/server/ports"
import { sanitizeRoomStateForClient } from "@/server/realtime/services/room-security"
import { peekPresenceRevision } from "@/server/realtime/broadcast/presence-seq"
import type {
  PresencePatch,
  RoomSnapshotPayload,
  RoomState,
} from "@/contracts/types"

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

export async function buildSanitizedSnapshot(
  store: RoomStateStorePort | null,
  roomId: string,
): Promise<RoomSnapshotPayload | null> {
  if (!store || typeof store.get !== "function") return null
  const state = await store.get(roomId)
  if (!state) return null

  const overlay = await store.getPresenceDataAll(roomId)
  applyPresenceOverlay(state, overlay)

  const presenceRevision = await peekPresenceRevision(roomId)

  return sanitizeRoomStateForClient({
    ...state,
    presenceRevision,
    playback: { ...state.playback, seekPreview: undefined },
  })
}
