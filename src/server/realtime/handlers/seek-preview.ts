import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import { canControlFromConnectionContext } from "@/server/realtime/services/permissions"
import { seekPreviewSchema } from "@/zod/schemas"
import type { RoomMessageHandler } from "./types"

/**
 * Ephemeral seek preview: fan-out on room:control without Redis room write.
 */
export const handleSeekPreview: RoomMessageHandler = async (ctx, data) => {
  const previewResult = seekPreviewSchema.safeParse(data.payload)
  if (!previewResult.success) return

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
        targetMs: Number(previewResult.data.targetMs ?? 0),
        active: Boolean(previewResult.data.active ?? true),
        updatedAt: nowMs,
      },
    },
  })
}
