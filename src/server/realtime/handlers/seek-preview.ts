import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import { canControlFromConnectionContext } from "@/server/realtime/services/permissions"
import { seekPreviewSchema } from "@/contracts/schemas"
import { connectionAuthFromContext } from "./mutate-controlled"
import { parseOrWarn } from "./parse-or-warn"
import type { RoomMessageHandler } from "./types"

/**
 * Seek scrubbing fan-out (ephemeral only).
 * - `active: true` — preview on room:control (no Redis write).
 * - `active: false` — ignored; end scrub via authoritative `playback:seek`.
 */
export const handleSeekPreview: RoomMessageHandler = async (ctx, data) => {
  const preview = parseOrWarn(seekPreviewSchema, data.payload, data.type)
  if (!preview) return

  const active = Boolean(preview.active ?? true)
  if (!active) {
    // Do not commit timeline here — that duplicates `playback:seek`.
    return
  }

  const targetMs = Math.max(0, Number(preview.targetMs ?? 0))

  const state = await ctx.store.get(ctx.roomId)
  if (!state) return

  if (
    !canControlFromConnectionContext(
      state,
      ctx.userId,
      connectionAuthFromContext(ctx),
    )
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
