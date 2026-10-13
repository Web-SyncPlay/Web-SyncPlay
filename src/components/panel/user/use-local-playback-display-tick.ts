"use client"

import type { ParticipantState } from "@/contracts/types"
import { shouldExtrapolateLocalPlayback } from "@/shared/local-playback-display"
import { useEffect, useState } from "react"

const DISPLAY_TICK_MS = 400

/**
 * Shared wall-clock tick for user-row playhead extrapolation. Runs only while
 * at least one participant is playing/ready so paused rooms stay quiet.
 */
export function useLocalPlaybackDisplayTick(
  participants: Iterable<ParticipantState>,
): number {
  const needsTick = (() => {
    for (const user of participants) {
      if (shouldExtrapolateLocalPlayback(user.localPlayback)) {
        return true
      }
    }
    return false
  })()

  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!needsTick) {
      return
    }
    const timer = window.setInterval(() => {
      setNowMs(Date.now())
    }, DISPLAY_TICK_MS)
    return () => window.clearInterval(timer)
  }, [needsTick])

  return nowMs
}
