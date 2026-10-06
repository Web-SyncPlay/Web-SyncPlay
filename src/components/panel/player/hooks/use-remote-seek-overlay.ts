"use client"

import { formatClockMs } from "@/lib/time-format"
import type { RoomState } from "@/zod/types"
import { useMemo, useState, useEffect } from "react"

/** Drop stuck remote seek overlays when the final seek never arrives. */
const REMOTE_SEEK_STALE_MS = 2_500

export function useRemoteSeekOverlay(config: {
  roomState: RoomState
  userId: string
  mediaDurationMs: number
}) {
  const { roomState, userId, mediaDurationMs } = config
  const remoteSeekPreview = roomState.playback.seekPreview
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (remoteSeekPreview?.active !== true) {
      return
    }
    const timer = window.setInterval(() => {
      setNowMs(Date.now())
    }, 500)
    return () => window.clearInterval(timer)
  }, [remoteSeekPreview?.active])

  return useMemo(() => {
    const updatedAt = Number(remoteSeekPreview?.updatedAt ?? 0)
    const isFresh =
      !Number.isFinite(updatedAt) ||
      updatedAt <= 0 ||
      nowMs - updatedAt <= REMOTE_SEEK_STALE_MS
    const isOtherUserSeeking =
      remoteSeekPreview?.active === true &&
      remoteSeekPreview.userId !== userId &&
      isFresh
    const remoteSeekerName =
      remoteSeekPreview?.userId &&
      roomState.participants[remoteSeekPreview.userId]
        ? (roomState.participants[remoteSeekPreview.userId]?.username ??
          "Another user")
        : "Another user"
    const remoteSeekTargetMs = Math.max(
      0,
      Number(remoteSeekPreview?.targetMs ?? 0),
    )
    const seekProgressPercent =
      mediaDurationMs > 0
        ? Math.min(100, (remoteSeekTargetMs / mediaDurationMs) * 100)
        : 0
    const totalTimeLabel =
      mediaDurationMs > 0 ? formatClockMs(mediaDurationMs) : "--:--"

    return {
      isOtherUserSeeking,
      remoteSeekerName,
      remoteSeekTargetMs,
      seekProgressPercent,
      totalTimeLabel,
    }
  }, [
    mediaDurationMs,
    nowMs,
    remoteSeekPreview,
    roomState.participants,
    userId,
  ])
}
