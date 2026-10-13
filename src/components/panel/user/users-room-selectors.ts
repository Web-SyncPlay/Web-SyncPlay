import type { ClientRoomState, ParticipantState } from "@/contracts/types"
import { resolveCatalogDurationMs } from "@/shared/playlist-duration"

/**
 * Users panel intentionally tracks presence (connected / lastSeen) for online
 * badges and relative-seen tooltips. This slice is not memo-isolated from
 * presence churn — it exists so callers select explicitly rather than
 * threading full roomState into list rows by accident.
 */
export type UsersPanelSlice = {
  participants: Record<string, ParticipantState>
  /** Room playback rate for peer playhead extrapolation between presence ticks. */
  playbackRate: number
  /** Catalog duration of the current item; caps extrapolated clocks when known. */
  currentDurationMs: number | null
}

export function selectUsersPanelSlice(
  roomState: ClientRoomState,
): UsersPanelSlice {
  const current = roomState.playlist[roomState.currentIndex]
  return {
    participants: roomState.participants,
    playbackRate: roomState.playback.playbackRate,
    currentDurationMs: resolveCatalogDurationMs(current),
  }
}
