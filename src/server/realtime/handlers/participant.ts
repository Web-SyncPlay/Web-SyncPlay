import { resolveStyle } from "@/lib/avatar"
import { appendActionLog } from "@/server/log"
import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import {
  participantRoleUpdateSchema,
  participantUpdateSchema,
} from "@/zod/schemas"
import type { PresencePatch } from "@/zod/types"
import { mutateRoomMessage } from "./mutate-room"
import type { RoomMessageHandler } from "./types"

export const handleParticipantUpdate: RoomMessageHandler = async (
  ctx,
  data,
) => {
  const participantResult = participantUpdateSchema.safeParse(data.payload)
  if (!participantResult.success) {
    return
  }

  const state = await ctx.store.get(ctx.roomId)
  const participant = state?.participants[ctx.userId]
  if (!state || !participant) {
    return
  }

  const previousUsername = participant.username
  const previousError = participant.localPlayback.error
  const previousAvatar = participant.avatarStyle
  const previousPlayback = participant.localPlayback

  const nextUsername = String(
    participantResult.data.username ?? participant.username,
  )
  const nextAvatarStyle = resolveStyle(
    String(participantResult.data.avatarStyle ?? participant.avatarStyle),
  )
  const nextPaused = Boolean(
    participantResult.data.paused ?? previousPlayback.paused,
  )
  const nextCurrentTimeMs = Number(
    participantResult.data.currentTimeMs ?? previousPlayback.currentTimeMs,
  )
  const nextLoading = Boolean(
    participantResult.data.loading ?? previousPlayback.loading,
  )
  // Explicit null/empty clears; omit keeps the previous sticky error.
  const nextError =
    participantResult.data.error === null
      ? undefined
      : typeof participantResult.data.error === "string"
        ? participantResult.data.error.trim() || undefined
        : previousPlayback.error

  const timeDirty =
    Math.abs(nextCurrentTimeMs - previousPlayback.currentTimeMs) >= 750
  const identityDirty =
    nextUsername !== previousUsername || nextAvatarStyle !== previousAvatar
  const playbackDirty =
    nextPaused !== previousPlayback.paused ||
    nextLoading !== previousPlayback.loading ||
    nextError !== previousError ||
    timeDirty

  if (!identityDirty && !playbackDirty) {
    return
  }

  const now = Date.now()
  const localPlayback = {
    paused: nextPaused,
    currentTimeMs: nextCurrentTimeMs,
    loading: nextLoading,
    error: nextError,
    updatedAt: now,
  }

  // Presence ticks never rewrite full room state.
  if (playbackDirty) {
    const patch: PresencePatch = {
      connected: true,
      lastSeenAt: now,
      localPlayback,
      username: nextUsername,
      avatarStyle: nextAvatarStyle,
    }
    await ctx.store.mergePresenceData(ctx.roomId, ctx.userId, patch)
    getRoomBroadcastBus().markPresenceDirty(ctx.roomId, ctx.userId, patch)
  }

  // Identity / error-log changes persist structurally.
  if (identityDirty || (playbackDirty && nextError !== previousError)) {
    await mutateRoomMessage(
      ctx.store,
      ctx.roomId,
      ctx.userId,
      (room, p) => {
        if (identityDirty) {
          p.username = nextUsername
          if (p.username !== previousUsername) {
            appendActionLog(room, {
              roomId: ctx.roomId,
              actorUserId: ctx.userId,
              actorUsername: p.username,
              action: "participant:username",
              payload: {
                previousUsername,
                nextUsername: p.username,
              },
            })
          }
          p.avatarStyle = nextAvatarStyle
        }
        // Keep last-known localPlayback on room for repair/join seed.
        p.localPlayback = localPlayback
        if (
          typeof participantResult.data.error === "string" &&
          previousError !== participantResult.data.error
        ) {
          appendActionLog(room, {
            roomId: ctx.roomId,
            actorUserId: ctx.userId,
            actorUsername: p.username,
            action: "participant:error",
            payload: {
              currentTimeMs: localPlayback.currentTimeMs,
            },
            error: participantResult.data.error,
          })
        }
        return true
      },
      { kind: "snapshot" },
    )
  }
}

export const handleParticipantRoleUpdate: RoomMessageHandler = async (
  ctx,
  data,
) => {
  const roleUpdateResult = participantRoleUpdateSchema.safeParse(data.payload)
  if (!roleUpdateResult.success) {
    return
  }

  await mutateRoomMessage(
    ctx.store,
    ctx.roomId,
    ctx.userId,
    (state, participant) => {
      if (state.ownerId !== ctx.userId) {
        return false
      }
      const { targetUserId, role } = roleUpdateResult.data
      const target = state.participants[targetUserId]
      if (!target) {
        return false
      }
      if (target.userId === state.ownerId) {
        return false
      }
      if (role === "owner") {
        return false
      }
      const previousRole = target.role
      if (previousRole !== role) {
        target.role = role
        appendActionLog(state, {
          roomId: ctx.roomId,
          actorUserId: ctx.userId,
          actorUsername: participant.username,
          action: "participant:role:changed",
          payload: {
            targetUserId: target.userId,
            targetUsername: target.username,
            fromRole: previousRole,
            toRole: target.role,
          },
        })
      }
      return true
    },
    { kind: "snapshot" },
  )
}
