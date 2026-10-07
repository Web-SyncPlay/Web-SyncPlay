import { resolveStyle } from "@/lib/avatar"
import { appendActionLog } from "@/server/log"
import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import {
  participantRoleUpdateSchema,
  participantUpdateSchema,
} from "@/zod/schemas"
import type { PresencePatch, ParticipantState } from "@/zod/types"
import type { z } from "zod"
import { mutateOwnerRoomMessage } from "./mutate-controlled"
import { mutateRoomMessage } from "./mutate-room"
import type { RoomMessageHandler } from "./types"

type ParticipantUpdateInput = z.infer<typeof participantUpdateSchema>

const PLAYBACK_TIME_DIRTY_MS = 750

/** Explicit null/empty clears; omit keeps the previous sticky error. */
export function resolveLocalPlaybackError(
  nextError: ParticipantUpdateInput["error"],
  previousError: string | undefined,
): string | undefined {
  if (nextError === null) return undefined
  if (typeof nextError === "string") return nextError.trim() || undefined
  return previousError
}

export function resolveParticipantUpdate(
  participant: ParticipantState,
  patch: ParticipantUpdateInput,
) {
  const previousUsername = participant.username
  const previousError = participant.localPlayback.error
  const previousAvatar = participant.avatarStyle
  const previousPlayback = participant.localPlayback

  const nextUsername = String(patch.username ?? participant.username)
  const nextAvatarStyle = resolveStyle(
    String(patch.avatarStyle ?? participant.avatarStyle),
  )
  const nextPaused = Boolean(patch.paused ?? previousPlayback.paused)
  const nextCurrentTimeMs = Number(
    patch.currentTimeMs ?? previousPlayback.currentTimeMs,
  )
  const nextLoading = Boolean(patch.loading ?? previousPlayback.loading)
  const nextError = resolveLocalPlaybackError(patch.error, previousError)

  const timeDirty =
    Math.abs(nextCurrentTimeMs - previousPlayback.currentTimeMs) >=
    PLAYBACK_TIME_DIRTY_MS
  const identityDirty =
    nextUsername !== previousUsername || nextAvatarStyle !== previousAvatar
  const playbackDirty =
    nextPaused !== previousPlayback.paused ||
    nextLoading !== previousPlayback.loading ||
    nextError !== previousError ||
    timeDirty

  const now = Date.now()
  const localPlayback = {
    paused: nextPaused,
    currentTimeMs: nextCurrentTimeMs,
    loading: nextLoading,
    error: nextError,
    updatedAt: now,
  }

  return {
    previousUsername,
    previousError,
    nextUsername,
    nextAvatarStyle,
    localPlayback,
    identityDirty,
    playbackDirty,
    now,
  }
}

function presencePatchFromUpdate(update: ReturnType<typeof resolveParticipantUpdate>): PresencePatch {
  return {
    connected: true,
    lastSeenAt: update.now,
    localPlayback: update.localPlayback,
    username: update.nextUsername,
    avatarStyle: update.nextAvatarStyle,
  }
}

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

  const update = resolveParticipantUpdate(participant, participantResult.data)
  if (!update.identityDirty && !update.playbackDirty) {
    return
  }

  // Presence ticks never rewrite full room state.
  if (update.playbackDirty) {
    const patch = presencePatchFromUpdate(update)
    await ctx.store.mergePresenceData(ctx.roomId, ctx.userId, patch)
    getRoomBroadcastBus().markPresenceDirty(ctx.roomId, ctx.userId, patch)
  }

  // Identity / error-log changes persist structurally.
  if (
    update.identityDirty ||
    (update.playbackDirty &&
      update.localPlayback.error !== update.previousError)
  ) {
    await mutateRoomMessage(
      ctx.store,
      ctx.roomId,
      ctx.userId,
      (room, p) => {
        if (update.identityDirty) {
          p.username = update.nextUsername
          if (p.username !== update.previousUsername) {
            appendActionLog(room, {
              roomId: ctx.roomId,
              actorUserId: ctx.userId,
              actorUsername: p.username,
              action: "participant:username",
              payload: {
                previousUsername: update.previousUsername,
                nextUsername: p.username,
              },
            })
          }
          p.avatarStyle = update.nextAvatarStyle
        }
        // Keep last-known localPlayback on room for repair/join seed.
        p.localPlayback = update.localPlayback
        if (
          typeof participantResult.data.error === "string" &&
          update.previousError !== participantResult.data.error
        ) {
          appendActionLog(room, {
            roomId: ctx.roomId,
            actorUserId: ctx.userId,
            actorUsername: p.username,
            action: "participant:error",
            payload: {
              currentTimeMs: update.localPlayback.currentTimeMs,
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

  await mutateOwnerRoomMessage(
    ctx,
    (state, participant) => {
      const { targetUserId, role } = roleUpdateResult.data
      const target = state.participants[targetUserId]
      if (!target || target.userId === state.ownerId) {
        return false
      }
      const previousRole = target.role
      if (previousRole === role) {
        return true
      }
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
      return true
    },
    { kind: "snapshot" },
  )
}
