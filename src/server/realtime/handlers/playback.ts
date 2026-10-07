import { appendActionLog } from "@/server/log"
import {
  commitPlaybackSeek,
  nextMonotonicMs,
  reanchorPlaybackAtNow,
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
      const { fromMs, toMs } = commitPlaybackSeek(
        state,
        seekResult.data.targetMs,
      )
      appendActionLog(state, {
        roomId: ctx.roomId,
        actorUserId: ctx.userId,
        actorUsername: participant.username,
        action: "playback:seek",
        payload: { fromMs, toMs },
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
      // Keep ephemeral seekPreview — only authoritative seeks clear it.
      state.playback.timelineAnchorMs = Math.max(0, nextAnchorMs)
      state.playback.paused = paused
      state.playback.serverNowMs = nextMonotonicMs(
        state.playback.serverNowMs,
        nowMs,
      )
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
      reanchorPlaybackAtNow(state)
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

type LoopScope = "video" | "playlist"

async function setPlaybackLoopMode(
  ctx: Parameters<RoomMessageHandler>[0],
  data: Parameters<RoomMessageHandler>[1],
  scope: LoopScope,
) {
  const modeResult = playbackLoopModeSchema.safeParse(data.payload)
  if (!modeResult.success) {
    return
  }

  await mutateControlledRoomMessage(
    ctx,
    (state, participant) => {
      const field = scope === "video" ? "videoLoop" : "playlistLoop"
      const previousMode = state.playback[field]
      state.playback[field] = modeResult.data.mode as LoopMode
      if (previousMode !== state.playback[field]) {
        appendActionLog(state, {
          roomId: ctx.roomId,
          actorUserId: ctx.userId,
          actorUsername: participant.username,
          action: "playback:loop",
          payload: {
            scope,
            previousMode,
            nextMode: state.playback[field],
            enabled: state.playback[field] !== "off",
          },
        })
      }
      return true
    },
    { kind: "control" },
  )
}

export const handlePlaybackLoopVideo: RoomMessageHandler = async (
  ctx,
  data,
) => {
  await setPlaybackLoopMode(ctx, data, "video")
}

export const handlePlaybackLoopPlaylist: RoomMessageHandler = async (
  ctx,
  data,
) => {
  await setPlaybackLoopMode(ctx, data, "playlist")
}
