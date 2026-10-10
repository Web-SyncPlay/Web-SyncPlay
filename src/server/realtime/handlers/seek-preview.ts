import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import { canControlFromConnectionContext } from "@/server/realtime/services/permissions"
import { seekPreviewSchema } from "@/contracts/schemas"
import type { PlaybackState } from "@/contracts/types"
import { getSocketMeta, setSocketCanControlPlayback } from "@/server/ws/registry"
import { connectionAuthFromContext } from "./mutate-controlled"
import { parseOrWarn } from "./parse-or-warn"
import type { RoomMessageHandler } from "./types"

/**
 * Seek scrubbing fan-out (ephemeral only).
 * - `active: true` — preview on room:control (no Redis write).
 * - `active: false` — ignored; end scrub via authoritative `playback:seek`.
 *
 * Hot path: prefer socket `canControlPlayback` + bus control projection to skip
 * a full room GET on every scrub frame.
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
  const auth = connectionAuthFromContext(ctx)
  const bus = getRoomBroadcastBus()
  const meta = getSocketMeta(ctx.ws)
  const cached = bus.getCachedControlProjection(ctx.roomId)

  // Joined non-controllers are denied without a room GET.
  if (meta?.canControlPlayback === false) {
    return
  }

  let generation: number
  let currentIndex: number
  let playback: PlaybackState

  if (meta?.canControlPlayback === true && cached) {
    generation = cached.generation
    currentIndex = cached.currentIndex
    playback = cached.playback
  } else {
    const state = await ctx.store.get(ctx.roomId)
    if (!state) return

    const allowed = canControlFromConnectionContext(state, ctx.userId, auth)
    if (meta) {
      setSocketCanControlPlayback(ctx.ws, allowed)
    }
    if (!allowed) return

    generation = state.generation ?? 0
    currentIndex = state.currentIndex
    playback = state.playback
    bus.rememberControlProjection(ctx.roomId, {
      generation,
      currentIndex,
      updatedAt: Date.now(),
      playback,
    })
  }

  const nowMs = Date.now()
  await bus.publishControlEphemeral(ctx.roomId, {
    generation,
    currentIndex,
    updatedAt: nowMs,
    playback: {
      ...playback,
      seekPreview: {
        userId: ctx.userId,
        targetMs,
        active: true,
        updatedAt: nowMs,
      },
    },
  })
}
