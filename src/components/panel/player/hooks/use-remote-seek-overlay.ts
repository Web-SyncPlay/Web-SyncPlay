"use client"

import { formatClockMs } from "@/shared/time-format"
import type { PlaybackState } from "@/contracts/types"
import { useMemo, useState, useEffect } from "react"

/** Drop stuck remote seek overlays when the final seek never arrives. */
const REMOTE_SEEK_STALE_MS = 2_500

export function useRemoteSeekOverlay(config: {
  seekPreview: PlaybackState["seekPreview"]
  /** Preselected display name — avoids depending on the participants map. */
  remoteSeekerName: string
  userId: string
  mediaDurationMs: number
}) {
  const { seekPreview, remoteSeekerName, userId, mediaDurationMs } = config
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (seekPreview?.active !== true) {
      return
    }
    const timer = window.setInterval(() => {
      setNowMs(Date.now())
    }, 500)
    return () => window.clearInterval(timer)
  }, [seekPreview?.active])

  return useMemo(() => {
    const updatedAt = Number(seekPreview?.updatedAt ?? 0)
    const isFresh =
      !Number.isFinite(updatedAt) ||
      updatedAt <= 0 ||
      nowMs - updatedAt <= REMOTE_SEEK_STALE_MS
    const isOtherUserSeeking =
      seekPreview?.active === true &&
      seekPreview.userId !== userId &&
      isFresh
    const remoteSeekTargetMs = Math.max(
      0,
      Number(seekPreview?.targetMs ?? 0),
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
  }, [mediaDurationMs, nowMs, remoteSeekerName, seekPreview, userId])
}
