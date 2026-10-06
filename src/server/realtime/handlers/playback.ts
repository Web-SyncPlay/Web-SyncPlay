import { appendActionLog } from "@/server/log"
import {
  nextMonotonicMs,
  resolveCurrentTimelineMs,
} from "@/server/realtime/services/timeline"
import {
  playbackLoopModeSchema,
  playbackRateSchema,
  playbackSeekSchema,
  playbackSetPausedSchema,
} from "@/zod/schemas"
import type { LoopMode } from "@/zod/types"
import { mutateControlledRoomMessage } from "./mutate-controlled"
import type { RoomMessageHandler } from "./types"

export const handlePlaybackSeek: RoomMessageHandler = async (ctx, data) => {
  const seekResult = playbackSeekSchema.safeParse(data.payload)
  if (!seekResult.success) {
    return
  }

  await mutateControlledRoomMessage(
    ctx,
    (state, participant) => {
      const fromMs = Math.max(
        0,
        Math.floor(resolveCurrentTimelineMs(state, Date.now())),
      )
      const nowMs = nextMonotonicMs(state.playback.serverNowMs, Date.now())
      state.playback.timelineAnchorMs = Math.max(0, seekResult.data.targetMs)
      state.playback.serverNowMs = nowMs
      // Clear persisted preview; live scrubbing is ephemeral on the control channel.
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
}

async function setPlaybackPausedState(
  ctx: Parameters<RoomMessageHandler>[0],
  data: Parameters<RoomMessageHandler>[1],
  paused: boolean,
) {
  const payloadResult = playbackSetPausedSchema.safeParse(data.payload)
  if (!payloadResult.success) {
    return
  }

  await mutateControlledRoomMessage(
    ctx,
    (state, participant) => {
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
        action: paused ? "playback:pause" : "playback:unpause",
        payload: { atMs: state.playback.timelineAnchorMs },
      })
      return true
    },
    { kind: "control" },
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

  await mutateControlledRoomMessage(
    ctx,
    (state, participant) => {
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
    { kind: "control" },
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

  await mutateControlledRoomMessage(
    ctx,
    (state, participant) => {
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
    { kind: "control" },
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

  await mutateControlledRoomMessage(
    ctx,
    (state, participant) => {
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
    { kind: "control" },
  )
}
