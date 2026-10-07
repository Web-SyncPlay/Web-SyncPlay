import { resolveStyle } from "@/lib/avatar"
import { appendActionLog } from "@/server/log"
import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import {
  aggregateLocalPlaybackReports,
  clientPresencePatch,
  upsertLocalPlaybackReport,
} from "@/server/realtime/services/local-playback-presence"
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
  const localPlayback: ParticipantState["localPlayback"] = {
    paused: nextPaused,
    currentTimeMs: nextCurrentTimeMs,
    loading: nextLoading,
    updatedAt: now,
  }
  if (nextError !== undefined) {
    localPlayback.error = nextError
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

function presencePatchFromAggregated(input: {
  now: number
  username: string
  avatarStyle: string
  localPlayback: ParticipantState["localPlayback"]
  localPlaybackReports: NonNullable<PresencePatch["localPlaybackReports"]>
}): PresencePatch {
  return {
    connected: true,
    lastSeenAt: input.now,
    localPlayback: input.localPlayback,
    localPlaybackReports: input.localPlaybackReports,
    username: input.username,
    avatarStyle: input.avatarStyle,
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

  const connectionId = ctx.connectionId
  const presenceAll = await ctx.store.getPresenceDataAll(ctx.roomId)
  const existingReports =
    presenceAll[ctx.userId]?.localPlaybackReports ?? {}
  const previousReport = existingReports[connectionId]
  const previousForConnection: ParticipantState["localPlayback"] =
    previousReport
      ? {
          paused: previousReport.paused,
          currentTimeMs: previousReport.currentTimeMs,
          loading: previousReport.loading,
          updatedAt: previousReport.updatedAt,
          ...(previousReport.error !== undefined
            ? { error: previousReport.error }
            : {}),
        }
      : participant.localPlayback

  const update = resolveParticipantUpdate(
    { ...participant, localPlayback: previousForConnection },
    participantResult.data,
  )
  if (!update.identityDirty && !update.playbackDirty) {
    return
  }

  let aggregatedPlayback = update.localPlayback

  // Presence ticks never rewrite full room state.
  if (update.playbackDirty) {
    const reports = upsertLocalPlaybackReport({
      reports: existingReports,
      connectionId,
      sessionKind: ctx.sessionKind,
      snapshot: update.localPlayback,
    })
    aggregatedPlayback =
      aggregateLocalPlaybackReports(reports, update.now) ?? update.localPlayback
    const patch = presencePatchFromAggregated({
      now: update.now,
      username: update.nextUsername,
      avatarStyle: update.nextAvatarStyle,
      localPlayback: aggregatedPlayback,
      localPlaybackReports: reports,
    })
    await ctx.store.mergePresenceData(ctx.roomId, ctx.userId, patch)
    getRoomBroadcastBus().markPresenceDirty(
      ctx.roomId,
      ctx.userId,
      clientPresencePatch(patch),
    )
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
        // Keep last-known aggregated localPlayback on room for repair/join seed.
        p.localPlayback = aggregatedPlayback
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
              currentTimeMs: aggregatedPlayback.currentTimeMs,
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
