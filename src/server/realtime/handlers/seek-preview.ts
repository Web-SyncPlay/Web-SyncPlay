import { appendActionLog } from "@/server/log"
import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import { canControlFromConnectionContext } from "@/server/realtime/services/permissions"
import {
  nextMonotonicMs,
  resolveCurrentTimelineMs,
} from "@/server/realtime/services/timeline"
import { seekPreviewSchema } from "@/zod/schemas"
import { mutateControlledRoomMessage } from "./mutate-controlled"
import type { RoomMessageHandler } from "./types"

/**
 * Seek scrubbing fan-out.
 * - `active: true` — ephemeral preview on room:control (no Redis write).
 * - `active: false` — persist the target timeline so peers sync even when the
 *   client never emits a follow-up `playback:seek` (common after MediaError /
 *   providers that skip the final seek-request).
 */
export const handleSeekPreview: RoomMessageHandler = async (ctx, data) => {
  const previewResult = seekPreviewSchema.safeParse(data.payload)
  if (!previewResult.success) return

  const active = Boolean(previewResult.data.active ?? true)
  const targetMs = Math.max(0, Number(previewResult.data.targetMs ?? 0))

  if (!active) {
    await mutateControlledRoomMessage(
      ctx,
      (state, participant) => {
        const fromMs = Math.max(
          0,
          Math.floor(resolveCurrentTimelineMs(state, Date.now())),
        )
        const nowMs = nextMonotonicMs(state.playback.serverNowMs, Date.now())
        state.playback.timelineAnchorMs = targetMs
        state.playback.serverNowMs = nowMs
        state.playback.seekPreview = undefined
        appendActionLog(state, {
          roomId: ctx.roomId,
          actorUserId: ctx.userId,
          actorUsername: participant.username,
          action: "playback:seek",
          payload: { fromMs, toMs: state.playback.timelineAnchorMs },
        })
        return true
      },
      { kind: "control" },
    )
    return
  }

  const state = await ctx.store.get(ctx.roomId)
  if (!state) return

  if (
    !canControlFromConnectionContext(state, ctx.userId, {
      controlAuthorized: ctx.controlAuthorized,
      isControlSession: ctx.isControlSession,
      sessionKind: ctx.sessionKind,
    })
  ) {
    return
  }

  const nowMs = Date.now()
  const bus = getRoomBroadcastBus()
  await bus.publishControlEphemeral(ctx.roomId, {
    generation: state.generation ?? 0,
    currentIndex: state.currentIndex,
    updatedAt: nowMs,
    playback: {
      ...state.playback,
      seekPreview: {
        userId: ctx.userId,
        targetMs,
        active: true,
        updatedAt: nowMs,
      },
    },
  })
}
