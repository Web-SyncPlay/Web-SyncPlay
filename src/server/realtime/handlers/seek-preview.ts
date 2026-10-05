import { canControlFromConnectionContext } from "@/server/realtime/services/permissions"
import { seekPreviewSchema } from "@/zod/schemas"
import { mutateRoomMessage } from "./mutate-room"
import type { RoomMessageHandler } from "./types"

export const handleSeekPreview: RoomMessageHandler = async (ctx, data) => {
  const previewResult = seekPreviewSchema.safeParse(data.payload)
  if (!previewResult.success) return

  await mutateRoomMessage(ctx.store, ctx.roomId, ctx.userId, (state) => {
    if (
      !canControlFromConnectionContext(state, ctx.userId, {
        controlAuthorized: ctx.controlAuthorized,
        isControlSession: ctx.isControlSession,
        sessionKind: ctx.sessionKind,
      })
    )
      return false
    state.playback.seekPreview = {
      userId: ctx.userId,
      targetMs: Number(previewResult.data.targetMs ?? 0),
      active: Boolean(previewResult.data.active ?? true),
      updatedAt: Date.now(),
    }
    return true
  })
}
