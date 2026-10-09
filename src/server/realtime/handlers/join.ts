import { DEFAULT_AVATAR_STYLE, resolveStyle } from "@/lib/avatar"
import { appendActionLog } from "@/server/log"
import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import {
  applyOfflinePruning,
  clearPrune,
  reconcileParticipantsConnectivity,
  schedulePrune,
} from "@/server/realtime/services/participants"
import { authorizeControlSession } from "@/server/realtime/services/control-auth"
import { claimOrVerifyIdentitySecret } from "@/server/realtime/services/identity-store"
import { clearConnectionLocalPlaybackReport } from "@/server/realtime/services/local-playback-report-lifecycle"
import { transferOwnershipIfNeeded } from "@/server/realtime/services/ownership"
import {
  computeSessionCapabilities,
  normalizeParticipantRoles,
} from "@/server/realtime/services/permissions"
import {
  createInitialRoomState,
  evaluateCreateMediaSeed,
  scheduleResolvingPlaylistItems,
} from "@/server/realtime/services/room"
import { markCurrentMedia } from "@/server/realtime/services/timeline"
import {
  applyRoomStateRepair,
  logRoomStateRepairFindings,
} from "@/server/realtime/services/room-state-repair"
import {
  addSocket,
  getSocketClientIp,
  getSocketMeta,
  setSocketControlAuthorized,
  setSocketPresenceTracked,
} from "@/server/ws/registry"
import { consumeRateLimit } from "@/server/security/rate-limit"
import { roomJoinSchema } from "@/zod/schemas"
import type { SessionCapabilities } from "@/server/realtime/services/permissions"
import type { ParticipantState, SessionKind, WsEnvelope } from "@/zod/types"
import { randomUUID } from "node:crypto"
import type { WebSocket } from "ws"
import {
  ensureRoomSecurity,
  evaluateJoinAdmission,
} from "../services/room-security"
import type { JoinHandler } from "./types"

export function resolveJoinParticipantProfile(
  existingParticipant: ParticipantState | undefined,
  incoming: { username: string; avatarStyle: string },
): { username: string; avatarStyle: string } {
  if (existingParticipant) {
    return {
      username: existingParticipant.username,
      avatarStyle: existingParticipant.avatarStyle,
    }
  }

  return incoming
}

function sendEnvelope<TPayload>(
  ws: WebSocket,
  envelope: WsEnvelope<string, TPayload>,
) {
  try {
    ws.send(JSON.stringify(envelope))
  } catch (error) {
    console.error(`[realtime] failed to send ${envelope.type}`, error)
  }
}

export const handleRoomJoin: JoinHandler = async (ctx, data) => {
  const joinResult = roomJoinSchema.safeParse(data.payload)
  if (!joinResult.success) {
    console.warn("[realtime] invalid room:join payload", {
      payload: data.payload,
      issues: joinResult.error.issues,
    })
    return
  }

  const roomId = joinResult.data.roomId
  const userId = String(joinResult.data.userId || randomUUID())
  const username = String(joinResult.data.username || "guest")
  const avatarStyle = resolveStyle(
    String(joinResult.data.avatarStyle || DEFAULT_AVATAR_STYLE),
  )
  const userSecret = joinResult.data.userSecret
  const joinPassword = joinResult.data.joinPassword
  const sessionKind: SessionKind = joinResult.data.sessionKind ?? "room"
  const controlToken = joinResult.data.controlToken
  const initialMediaUrl = joinResult.data.initialMediaUrl

  const joinRoomLimit = await consumeRateLimit({
    key: `join:room:${roomId}`,
    limit: 60,
    windowMs: 60_000,
  })
  if (!joinRoomLimit.allowed) {
    sendEnvelope(ctx.ws, {
      type: "room:join:rejected",
      requestId: data.requestId,
      payload: { reason: "rate_limited" },
    })
    return
  }

  const clientIp = getSocketClientIp(ctx.ws)
  const joinIpLimit = await consumeRateLimit({
    key: `join:ip:${clientIp}:room:${roomId}`,
    limit: 12,
    windowMs: 60_000,
  })
  if (!joinIpLimit.allowed) {
    sendEnvelope(ctx.ws, {
      type: "room:join:rejected",
      requestId: data.requestId,
      payload: { reason: "rate_limited" },
    })
    return
  }

  const previousMeta = getSocketMeta(ctx.ws)
  if (
    previousMeta?.presenceTracked &&
    (previousMeta.roomId !== roomId || previousMeta.userId !== userId)
  ) {
    await ctx.store.removeWsConnectionRef(
      previousMeta.roomId,
      previousMeta.userId,
    )
    await clearConnectionLocalPlaybackReport(
      ctx.store,
      previousMeta.roomId,
      previousMeta.userId,
      previousMeta.connectionId,
    )
    setSocketPresenceTracked(ctx.ws, false)
  }

  const existingState = await ctx.store.get(roomId)
  const mediaSeed = evaluateCreateMediaSeed({
    roomExists: Boolean(existingState),
    initialMediaUrl,
  })
  if (!mediaSeed.ok) {
    sendEnvelope(ctx.ws, {
      type: "room:join:rejected",
      requestId: data.requestId,
      payload: { reason: mediaSeed.reason },
    })
    return
  }

  const admission = evaluateJoinAdmission(existingState, joinPassword)
  if (!admission.allowed) {
    sendEnvelope(ctx.ws, {
      type: "room:join:rejected",
      requestId: data.requestId,
      payload: {
        reason: admission.reason,
      },
    })
    return
  }

  const identityOk = await claimOrVerifyIdentitySecret({
    roomId,
    userId,
    userSecret,
  })
  if (!identityOk) {
    sendEnvelope(ctx.ws, {
      type: "room:join:rejected",
      requestId: data.requestId,
      payload: { reason: "identity_mismatch" },
    })
    return
  }

  const { isControlSession, controlAuthorized } = await authorizeControlSession({
    sessionKind,
    controlToken,
    roomId,
    userId,
  })

  addSocket(ctx.ws, {
    roomId,
    userId,
    controlAuthorized,
    isControlSession,
    sessionKind,
  })
  setSocketControlAuthorized(ctx.ws, controlAuthorized)
  const activeMeta = getSocketMeta(ctx.ws)
  const isPresenceAlreadyTracked = Boolean(activeMeta?.presenceTracked)

  let reconnectingUserIds: string[] = []
  let disconnectingUserIds: string[] = []

  let sessionCapabilities: SessionCapabilities | undefined

  const committed = await ctx.store.updateRoom(roomId, async (existing) => {
    const state =
      existing ??
      (await createInitialRoomState(ctx.store, roomId, userId, {
        initialMediaUrl: mediaSeed.seedUrl,
      }))
    normalizeParticipantRoles(state)
    logRoomStateRepairFindings({
      roomId,
      source: "join",
      findings: applyRoomStateRepair(state),
    })

    const active = await ctx.store.getWsPresenceUserIds(roomId)
    const recon = reconcileParticipantsConnectivity(state, active)
    reconnectingUserIds = recon.reconnecting
    disconnectingUserIds = recon.disconnecting

    applyOfflinePruning(state)

    await clearPrune(roomId, userId)
    const existingParticipant = state.participants[userId]
    const security = ensureRoomSecurity(state)
    const role: ParticipantState["role"] =
      existingParticipant?.role ??
      (state.ownerId === userId ? "owner" : security.defaultJoinRole)
    const now = Date.now()
    const participantProfile = resolveJoinParticipantProfile(
      existingParticipant,
      { username, avatarStyle },
    )
    const presenceOverlay = await ctx.store.getPresenceDataAll(roomId)
    const overlayPlayback = presenceOverlay[userId]?.localPlayback
    state.participants[userId] = {
      userId,
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

    if (!isPresenceAlreadyTracked || !existingParticipant?.connected) {
      appendActionLog(state, {
        roomId,
        actorUserId: userId,
        actorUsername: participantProfile.username,
        action: "participant:joined",
        payload: {},
      })
    }
    sessionCapabilities = computeSessionCapabilities({
      role: state.participants[userId]?.role ?? role,
      sessionKind,
      isControlSession,
      controlAuthorized,
    })
    markCurrentMedia(state)
    state.updatedAt = Date.now()
    state.generation = (state.generation ?? 0) + 1
    state.structuralRevision = (state.structuralRevision ?? 0) + 1
    return state
  })

  // Persist-first: presence ref only after a successful room commit.
  if (committed) {
    if (!isPresenceAlreadyTracked) {
      await ctx.store.addWsConnectionRef(roomId, userId)
      setSocketPresenceTracked(ctx.ws, true)
    }

    scheduleResolvingPlaylistItems(ctx.store, roomId, committed.playlist)

    const bus = getRoomBroadcastBus()
    bus.attachStore(ctx.store)
    await ctx.store.mergePresenceData(roomId, userId, {
      connected: true,
      lastSeenAt: Date.now(),
      localPlayback: committed.participants[userId]?.localPlayback,
      username: committed.participants[userId]?.username,
      avatarStyle: committed.participants[userId]?.avatarStyle,
    })

    // Critical: joiner must receive state without relying on store publish.
    const snapshot = await bus.buildSanitizedSnapshot(roomId)
    if (snapshot) {
      bus.sendToSocket(ctx.ws, { type: "room:snapshot", payload: snapshot })
    }
    bus.markSnapshotDirty(roomId)
    bus.markPresenceDirty(roomId, userId, {
      connected: true,
      lastSeenAt: Date.now(),
      localPlayback: committed.participants[userId]?.localPlayback,
    })
  }

  if (sessionCapabilities) {
    sendEnvelope(ctx.ws, {
      type: "session:capabilities",
      payload: sessionCapabilities,
    })
  }

  for (const uid of reconnectingUserIds) {
    await clearPrune(roomId, uid)
  }
  for (const uid of disconnectingUserIds) {
    await schedulePrune(roomId, uid)
  }
}
