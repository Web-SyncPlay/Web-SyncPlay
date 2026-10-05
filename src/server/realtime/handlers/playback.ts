import { appendActionLog } from "@/server/log"
import { canControlFromConnectionContext } from "@/server/realtime/services/permissions"
import { resolveCurrentTimelineMs } from "@/server/realtime/services/timeline"
import {
  playbackRateSchema,
  playbackSeekSchema,
  playbackSetPausedSchema,
} from "@/zod/schemas"
import type { LoopMode } from "@/zod/types"
import { z } from "zod"
import { mutateRoomMessage } from "./mutate-room"
import type { RoomMessageHandler } from "./types"

function nextMonotonicMs(previous: number, next: number) {
  return Math.max(previous + 1, next)
}

export const handlePlaybackSeek: RoomMessageHandler = async (ctx, data) => {
  const seekResult = playbackSeekSchema.safeParse(data.payload)
  if (!seekResult.success) {
    return
  }

  await mutateRoomMessage(
    ctx.store,
    ctx.roomId,
    ctx.userId,
    (state, participant) => {
      if (
        !canControlFromConnectionContext(state, ctx.userId, {
          controlAuthorized: ctx.controlAuthorized,
          isControlSession: ctx.isControlSession,
          sessionKind: ctx.sessionKind,
        })
      ) {
        return false
      }
      const fromMs = Math.max(
        0,
        Math.floor(resolveCurrentTimelineMs(state, Date.now())),
      )
      const nowMs = nextMonotonicMs(state.playback.serverNowMs, Date.now())
      state.playback.timelineAnchorMs = Math.max(0, seekResult.data.targetMs)
      state.playback.serverNowMs = nowMs
      state.playback.seekPreview = {
        userId: ctx.userId,
        targetMs: state.playback.timelineAnchorMs,
        active: false,
        updatedAt: nowMs,
      }
      appendActionLog(state, {
        roomId: ctx.roomId,
        actorUserId: ctx.userId,
        actorUsername: participant.username,
        action: "playback:seek",
        payload: { fromMs, toMs: state.playback.timelineAnchorMs },
      })
      return true
    },
  )
}

const playbackLoopModeSchema = z.object({
  mode: z.enum(["off", "always", "once"]),
})

async function setPlaybackPausedState(
  ctx: Parameters<RoomMessageHandler>[0],
  data: Parameters<RoomMessageHandler>[1],
  paused: boolean,
) {
  const payloadResult = playbackSetPausedSchema.safeParse(data.payload)
  if (!payloadResult.success) {
    return
  }

  await mutateRoomMessage(
    ctx.store,
    ctx.roomId,
    ctx.userId,
    (state, participant) => {
      if (
        !canControlFromConnectionContext(state, ctx.userId, {
          controlAuthorized: ctx.controlAuthorized,
          isControlSession: ctx.isControlSession,
          sessionKind: ctx.sessionKind,
        })
      ) {
        return false
      }
      const nowMs = Date.now()
      const projectedMs = resolveCurrentTimelineMs(state, nowMs)
      const nextAnchorMs = Number(
        payloadResult.data.currentTimeMs ?? projectedMs,
      )
      const syncNow = nextMonotonicMs(state.playback.serverNowMs, nowMs)
      state.playback.timelineAnchorMs = Math.max(0, nextAnchorMs)
      state.playback.paused = paused
      state.playback.serverNowMs = syncNow
      appendActionLog(state, {
        roomId: ctx.roomId,
        actorUserId: ctx.userId,
        actorUsername: participant.username,
        action: paused ? "playback:pause" : "playback:play",
        payload: { atMs: state.playback.timelineAnchorMs },
      })
      return true
    },
  )
}

export const handlePlaybackPlay: RoomMessageHandler = async (ctx, data) => {
  await setPlaybackPausedState(ctx, data, false)
}

export const handlePlaybackPause: RoomMessageHandler = async (ctx, data) => {
  await setPlaybackPausedState(ctx, data, true)
}

export const handlePlaybackRate: RoomMessageHandler = async (ctx, data) => {
  const rateResult = playbackRateSchema.safeParse(data.payload)
  if (!rateResult.success) {
    return
  }

  await mutateRoomMessage(
    ctx.store,
    ctx.roomId,
    ctx.userId,
    (state, participant) => {
      if (
        !canControlFromConnectionContext(state, ctx.userId, {
          controlAuthorized: ctx.controlAuthorized,
          isControlSession: ctx.isControlSession,
          sessionKind: ctx.sessionKind,
        })
      ) {
        return false
      }
      const nowMs = Date.now()
      const syncNow = nextMonotonicMs(state.playback.serverNowMs, nowMs)
      state.playback.timelineAnchorMs = resolveCurrentTimelineMs(state, nowMs)
      state.playback.serverNowMs = syncNow
      state.playback.playbackRate = rateResult.data.playbackRate
      appendActionLog(state, {
        roomId: ctx.roomId,
        actorUserId: ctx.userId,
        actorUsername: participant.username,
        action: "playback:rate",
        payload: { playbackRate: rateResult.data.playbackRate },
      })
      return true
    },
  )
}

export const handlePlaybackLoopVideo: RoomMessageHandler = async (
  ctx,
  data,
) => {
  const modeResult = playbackLoopModeSchema.safeParse(data.payload)
  if (!modeResult.success) {
    return
  }

  await mutateRoomMessage(
    ctx.store,
    ctx.roomId,
    ctx.userId,
    (state, participant) => {
      if (
        !canControlFromConnectionContext(state, ctx.userId, {
          controlAuthorized: ctx.controlAuthorized,
          isControlSession: ctx.isControlSession,
          sessionKind: ctx.sessionKind,
        })
      ) {
        return false
      }
      const previousMode = state.playback.videoLoop
      state.playback.videoLoop = modeResult.data.mode as LoopMode
      if (previousMode !== state.playback.videoLoop) {
        appendActionLog(state, {
          roomId: ctx.roomId,
          actorUserId: ctx.userId,
          actorUsername: participant.username,
          action: "playback:loop",
          payload: {
            scope: "video",
            previousMode,
            nextMode: state.playback.videoLoop,
            enabled: state.playback.videoLoop !== "off",
          },
        })
      }
      return true
    },
  )
}

export const handlePlaybackLoopPlaylist: RoomMessageHandler = async (
  ctx,
  data,
) => {
  const modeResult = playbackLoopModeSchema.safeParse(data.payload)
  if (!modeResult.success) {
    return
  }

  await mutateRoomMessage(
    ctx.store,
    ctx.roomId,
    ctx.userId,
    (state, participant) => {
      if (
        !canControlFromConnectionContext(state, ctx.userId, {
          controlAuthorized: ctx.controlAuthorized,
          isControlSession: ctx.isControlSession,
          sessionKind: ctx.sessionKind,
        })
      ) {
        return false
      }
      const previousMode = state.playback.playlistLoop
      state.playback.playlistLoop = modeResult.data.mode as LoopMode
      if (previousMode !== state.playback.playlistLoop) {
        appendActionLog(state, {
          roomId: ctx.roomId,
          actorUserId: ctx.userId,
          actorUsername: participant.username,
          action: "playback:loop",
          payload: {
            scope: "playlist",
            previousMode,
            nextMode: state.playback.playlistLoop,
            enabled: state.playback.playlistLoop !== "off",
          },
        })
      }
      return true
    },
  )
}
