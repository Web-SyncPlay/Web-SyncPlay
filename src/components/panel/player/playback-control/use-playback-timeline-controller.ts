"use client"

import { computeExpectedPlaybackTimeSec } from "@/lib/playback-sync"
import type { TypedRoomEventSender } from "@/lib/room-events"
import type { RoomState } from "@/zod/types"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPlaybackActions } from "./use-playback-actions"

const SEEK_ACK_MATCH_THRESHOLD_MS = 450
const SEEK_ACK_TIMEOUT_MS = 1_800
const SEEK_PREVIEW_THROTTLE_MS = 80

export type LocalSeekPhase = "idle" | "previewing" | "awaitingAck"

export function projectPlaybackMs(roomState: RoomState, nowMs = Date.now()) {
  return Math.floor(computeExpectedPlaybackTimeSec(roomState.playback, nowMs) * 1000)
}

export function usePlaybackTimelineController(config: {
  roomState: RoomState
  send: TypedRoomEventSender
  controlsDisabled: boolean
}) {
  const { roomState, send, controlsDisabled } = config
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [seekPhase, setSeekPhase] = useState<LocalSeekPhase>("idle")
  const [localSeekTargetMs, setLocalSeekTargetMs] = useState<number | null>(null)
  const awaitingSeekSinceRef = useRef<number | null>(null)
  const lastPreviewAtRef = useRef(0)

  useEffect(() => {
    const intervalMs = roomState.playback.paused ? 500 : 200
    const timer = window.setInterval(() => {
      setNowMs(Date.now())
    }, intervalMs)
    return () => window.clearInterval(timer)
  }, [roomState.playback.paused])

  const projectedElapsedMs = useMemo(
    () => projectPlaybackMs(roomState, nowMs),
    // Depend on playback fields only — presence batches must not recompute.
    [
      nowMs,
      roomState.playback.paused,
      roomState.playback.playbackRate,
      roomState.playback.timelineAnchorMs,
      roomState.playback.serverNowMs,
      roomState.currentIndex,
    ],
  )

  useEffect(() => {
    if (seekPhase !== "awaitingAck" || localSeekTargetMs === null) {
      return
    }
    const seekAccepted =
      Math.abs(roomState.playback.timelineAnchorMs - localSeekTargetMs) <=
      SEEK_ACK_MATCH_THRESHOLD_MS
    const expired =
      awaitingSeekSinceRef.current !== null &&
      Date.now() - awaitingSeekSinceRef.current > SEEK_ACK_TIMEOUT_MS

    if (seekAccepted || expired) {
      awaitingSeekSinceRef.current = null
      setSeekPhase("idle")
      setLocalSeekTargetMs(null)
    }
  }, [localSeekTargetMs, roomState.playback.timelineAnchorMs, seekPhase])

  const elapsedMs =
    seekPhase === "idle" || localSeekTargetMs === null
      ? projectedElapsedMs
      : localSeekTargetMs

  const playbackActions = createPlaybackActions({
    roomState,
    send,
    controlsDisabled,
    elapsedMs,
  })

  const sendSeekPreview = useCallback(
    (targetMs: number, force = false) => {
      const now = Date.now()
      if (!force && now - lastPreviewAtRef.current < SEEK_PREVIEW_THROTTLE_MS) {
        return
      }
      lastPreviewAtRef.current = now
      playbackActions.updateSeek(targetMs)
    },
    [playbackActions],
  )

  const beginSeek = useCallback(
    (targetMs: number) => {
      const nextTarget = Math.max(0, targetMs)
      setSeekPhase("previewing")
      setLocalSeekTargetMs(nextTarget)
      playbackActions.beginSeek(nextTarget)
      lastPreviewAtRef.current = Date.now()
    },
    [playbackActions],
  )

  const updateSeek = useCallback(
    (targetMs: number) => {
      const nextTarget = Math.max(0, targetMs)
      setSeekPhase("previewing")
      setLocalSeekTargetMs(nextTarget)
      sendSeekPreview(nextTarget)
    },
    [sendSeekPreview],
  )

  const endSeekPreview = useCallback(
    (targetMs: number) => {
      const nextTarget = Math.max(0, targetMs)
      playbackActions.endSeekPreview(nextTarget)
    },
    [playbackActions],
  )

  const commitSeek = useCallback(
    (targetMs: number) => {
      const nextTarget = Math.max(0, targetMs)
      awaitingSeekSinceRef.current = Date.now()
      setSeekPhase("awaitingAck")
      setLocalSeekTargetMs(nextTarget)
      playbackActions.commitSeek(nextTarget)
    },
    [playbackActions],
  )

  const selectAdjacent = useCallback(
    (direction: "previous" | "next") => {
      playbackActions.selectAdjacent(direction)
    },
    [playbackActions],
  )

  return {
    elapsedMs,
    seekPhase,
    awaitingSeekTargetMs: seekPhase === "awaitingAck" ? localSeekTargetMs : null,
    play: playbackActions.play,
    pause: playbackActions.pause,
    stepBy: playbackActions.stepBy,
    selectAdjacent,
    beginSeek,
    updateSeek,
    endSeekPreview,
    commitSeek,
  }
}
