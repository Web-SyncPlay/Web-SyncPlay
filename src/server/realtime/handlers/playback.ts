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
} from "@/contracts/schemas"
import type { LoopMode } from "@/contracts/types"
import { mutateControlledRoomMessage } from "./mutate-controlled"
import { parseOrNack } from "./parse-or-nack"
import type { RoomMessageHandler } from "./types"

export const handlePlaybackSeek: RoomMessageHandler = async (ctx, data) => {
  const seek = parseOrNack(playbackSeekSchema, ctx.ws, data)
  if (!seek) return

  await mutateControlledRoomMessage(
    ctx,
    data,
    (state, participant) => {
      const { fromMs, toMs } = commitPlaybackSeek(state, seek.targetMs)
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
  const payload = parseOrNack(playbackSetPausedSchema, ctx.ws, data)
  if (!payload) return

  await mutateControlledRoomMessage(
    ctx,
    data,
    (state, participant) => {
      const nowMs = Date.now()
      const projectedMs = resolveCurrentTimelineMs(state, nowMs)
      const nextAnchorMs = Number(payload.currentTimeMs ?? projectedMs)
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
  const rate = parseOrNack(playbackRateSchema, ctx.ws, data)
  if (!rate) return

  await mutateControlledRoomMessage(
    ctx,
    data,
    (state, participant) => {
      reanchorPlaybackAtNow(state)
      state.playback.playbackRate = rate.playbackRate
      appendActionLog(state, {
        roomId: ctx.roomId,
        actorUserId: ctx.userId,
        actorUsername: participant.username,
        action: "playback:rate",
        payload: { playbackRate: rate.playbackRate },
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
  const mode = parseOrNack(playbackLoopModeSchema, ctx.ws, data)
  if (!mode) return

  await mutateControlledRoomMessage(
    ctx,
    data,
    (state, participant) => {
      const field = scope === "video" ? "videoLoop" : "playlistLoop"
      const previousMode = state.playback[field]
      state.playback[field] = mode.mode as LoopMode
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
