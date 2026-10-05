import { seekPreviewSchema } from "@/zod/schemas"
import { mutateControlledRoomMessage } from "./mutate-controlled"
import type { RoomMessageHandler } from "./types"

export const handleSeekPreview: RoomMessageHandler = async (ctx, data) => {
  const previewResult = seekPreviewSchema.safeParse(data.payload)
  if (!previewResult.success) return

  await mutateControlledRoomMessage(ctx, (state) => {
    state.playback.seekPreview = {
      userId: ctx.userId,
      targetMs: Number(previewResult.data.targetMs ?? 0),
      active: Boolean(previewResult.data.active ?? true),
      updatedAt: Date.now(),
    }
    return true
  })
}
