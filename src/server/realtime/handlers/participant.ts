import { appendActionLog } from "@/server/log"
import {
  participantRoleUpdateSchema,
  participantUpdateSchema,
} from "@/zod/schemas"
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

  await mutateRoomMessage(
    ctx.store,
    ctx.roomId,
    ctx.userId,
    (state, participant) => {
      const previousUsername = participant.username
      const previousError = participant.localPlayback.error
      const previousAvatar = participant.avatarStyle
      const previousPlayback = participant.localPlayback

      const nextUsername = String(
        participantResult.data.username ?? participant.username,
      )
      const nextAvatarStyle = String(
        participantResult.data.avatarStyle ?? participant.avatarStyle,
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
      const nextError =
        typeof participantResult.data.error === "string"
          ? participantResult.data.error
          : previousPlayback.error

      // Skip Redis write + full-room fan-out when nothing meaningful changed.
      // Clients can tick often; time drift under 750ms is not worth a broadcast.
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
        return false
      }

      participant.username = nextUsername
      if (participant.username !== previousUsername) {
        appendActionLog(state, {
          roomId: ctx.roomId,
          actorUserId: ctx.userId,
          actorUsername: participant.username,
          action: "participant:username",
          payload: {
            previousUsername,
            nextUsername: participant.username,
          },
        })
      }
      participant.avatarStyle = nextAvatarStyle
      participant.localPlayback = {
        paused: nextPaused,
        currentTimeMs: nextCurrentTimeMs,
        loading: nextLoading,
        error: nextError,
        updatedAt: Date.now(),
      }
      if (typeof participantResult.data.error === "string") {
        if (previousError !== participantResult.data.error) {
          appendActionLog(state, {
            roomId: ctx.roomId,
            actorUserId: ctx.userId,
            actorUsername: participant.username,
            action: "participant:error",
            payload: {
              currentTimeMs: participant.localPlayback.currentTimeMs,
            },
            error: participantResult.data.error,
          })
        }
      }
      return true
    },
  )
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
  )
}
