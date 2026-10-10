import { DEFAULT_AVATAR_STYLE, resolveStyle } from "@/shared/avatar"
import { appendActionLog } from "@/server/log"
import {
  reconcileParticipantsConnectivity,
} from "@/server/realtime/services/participants"
import { transferOwnershipIfNeeded } from "@/server/realtime/services/ownership"
import {
  computeSessionCapabilities,
  normalizeParticipantRoles,
  type SessionCapabilities,
} from "@/server/realtime/services/permissions"
import { createInitialRoomState } from "@/server/realtime/services/room"
import { markCurrentMedia } from "@/server/realtime/services/timeline"
import {
  applyRoomStateRepair,
  logRoomStateRepairFindings,
} from "@/server/realtime/services/room-state-repair"
import type { RoomStateStorePort } from "@/server/ports"
import type {
  ParticipantState,
  RoomState,
  SessionKind,
} from "@/contracts/types"
import type { WebSocket } from "ws"
import { ensureRoomSecurity, evaluateJoinAdmission } from "../../services/room-security"
import { shouldAppendParticipantJoinedLog } from "./membership-timing"
import { resolveJoinParticipantProfile } from "./profile"
import { sendEnvelope } from "./send"

export type CommitMembershipInput = {
  ws: WebSocket
  store: RoomStateStorePort
  roomId: string
  userId: string
  username: string
  avatarStyle: string
  joinPassword: string | undefined
  seedUrl: string | undefined
  sessionKind: SessionKind
  isControlSession: boolean
  controlAuthorized: boolean
  isPresenceAlreadyTracked: boolean
  requestId?: string
}

export type CommitMembershipResult = {
  committed: RoomState | null
  reconnectingUserIds: string[]
  disconnectingUserIds: string[]
  sessionCapabilities: SessionCapabilities | undefined
}

/**
 * WATCH commit: re-admit, upsert participant, heal ownership, bump revisions.
 * Presence / prune Redis I/O runs outside WATCH (same pattern as cleanup).
 */
export async function commitJoinMembership(
  input: CommitMembershipInput,
): Promise<CommitMembershipResult> {
  let reconnectingUserIds: string[] = []
  let disconnectingUserIds: string[] = []
  let admissionRejectReason: "password_required" | "invalid_password" | undefined
  let sessionCapabilities: SessionCapabilities | undefined

  const avatarStyle = resolveStyle(
    String(input.avatarStyle || DEFAULT_AVATAR_STYLE),
  )
  const username = String(input.username || "guest")

  // Presence + overlay reads outside WATCH — never HASH-write from mutate.
  const activeConnections = await input.store.readWsPresenceUserIds(
    input.roomId,
  )
  await input.store.reconcilePresenceRefs(input.roomId)
  const presenceOverlay = await input.store.getPresenceDataAll(input.roomId)

  const committed = await input.store.updateRoom(input.roomId, async (existing) => {
    const state =
      existing ??
      (await createInitialRoomState(input.store, input.roomId, input.userId, {
        initialMediaUrl: input.seedUrl,
      }))

    // R5: re-check admission inside WATCH so password flips cannot race in.
    const admissionInWatch = await evaluateJoinAdmission(
      state,
      input.joinPassword,
    )
    if (!admissionInWatch.allowed) {
      admissionRejectReason = admissionInWatch.reason
      return null
    }

    normalizeParticipantRoles(state)
    logRoomStateRepairFindings({
      roomId: input.roomId,
      source: "join",
      findings: applyRoomStateRepair(state),
    })

    const recon = reconcileParticipantsConnectivity(state, activeConnections)
    reconnectingUserIds = recon.reconnecting
    disconnectingUserIds = recon.disconnecting

    const existingParticipant = state.participants[input.userId]
    const security = ensureRoomSecurity(state)
    const role: ParticipantState["role"] =
      existingParticipant?.role ??
      (state.ownerId === input.userId ? "owner" : security.defaultJoinRole)
    const now = Date.now()
    const participantProfile = resolveJoinParticipantProfile(
      existingParticipant,
      { username, avatarStyle },
    )
    const overlayPlayback = presenceOverlay[input.userId]?.localPlayback
    state.participants[input.userId] = {
      userId: input.userId,
      username: participantProfile.username,
      avatarStyle: participantProfile.avatarStyle,
      role,
      connected: true,
      joinedAt: existingParticipant?.joinedAt ?? now,
      connectedAt: now,
      disconnectedAt: undefined,
      lastSeenAt: now,
      localPlayback: {
        paused:
          overlayPlayback?.paused ??
          existingParticipant?.localPlayback.paused ??
          true,
        currentTimeMs:
          overlayPlayback?.currentTimeMs ??
          existingParticipant?.localPlayback.currentTimeMs ??
          0,
        loading:
          overlayPlayback?.loading ??
          existingParticipant?.localPlayback.loading ??
          false,
        error:
          overlayPlayback?.error ?? existingParticipant?.localPlayback.error,
        updatedAt: now,
      },
      viewerMedia: existingParticipant?.viewerMedia,
    }

    // Heal orphaned ownership once the joiner is connected in this commit.
    transferOwnershipIfNeeded(state, "join")

    if (
      shouldAppendParticipantJoinedLog(
        input.isPresenceAlreadyTracked,
        existingParticipant?.connected,
      )
    ) {
      appendActionLog(state, {
        roomId: input.roomId,
        actorUserId: input.userId,
        actorUsername: participantProfile.username,
        action: "participant:joined",
        payload: {},
      })
    }
    sessionCapabilities = computeSessionCapabilities({
      role: state.participants[input.userId]?.role ?? role,
      sessionKind: input.sessionKind,
      isControlSession: input.isControlSession,
      controlAuthorized: input.controlAuthorized,
    })
    markCurrentMedia(state)
    state.updatedAt = Date.now()
    state.generation = (state.generation ?? 0) + 1
    state.structuralRevision = (state.structuralRevision ?? 0) + 1
    return state
  })

  if (admissionRejectReason) {
    sendEnvelope(input.ws, {
      type: "room:join:rejected",
      requestId: input.requestId,
      payload: { reason: admissionRejectReason },
    })
    return {
      committed: null,
      reconnectingUserIds,
      disconnectingUserIds,
      sessionCapabilities: undefined,
    }
  }

  return {
    committed,
    reconnectingUserIds,
    disconnectingUserIds,
    sessionCapabilities,
  }
}
