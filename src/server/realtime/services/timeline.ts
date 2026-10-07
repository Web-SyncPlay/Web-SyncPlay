import type { RoomState } from "@/zod/types"

/** Ensure playback server clocks never move backwards under concurrent writes. */
export function nextMonotonicMs(previous: number, next: number) {
  return Math.max(previous + 1, next)
}

export function resolveCurrentTimelineMs(state: RoomState, nowMs: number) {
  if (state.playback.paused) {
    return state.playback.timelineAnchorMs
  }

  return (
    state.playback.timelineAnchorMs +
    Math.max(0, nowMs - state.playback.serverNowMs) *
      state.playback.playbackRate
  )
}

/**
 * Authoritative seek: snap the room timeline, clear ephemeral scrub state, and
 * advance the monotonic server clock. Shared by `playback:seek` and
 * `seek:preview` (active:false).
 */
export function commitPlaybackSeek(
  state: RoomState,
  targetMs: number,
  nowMs = Date.now(),
): { fromMs: number; toMs: number } {
  const fromMs = Math.max(
    0,
    Math.floor(resolveCurrentTimelineMs(state, nowMs)),
  )
  const toMs = Math.max(0, targetMs)
  state.playback.timelineAnchorMs = toMs
  state.playback.serverNowMs = nextMonotonicMs(state.playback.serverNowMs, nowMs)
  state.playback.seekPreview = undefined
  return { fromMs, toMs }
}

/**
 * Freeze the projected playhead as a new timeline anchor (rate changes,
 * transport toggles that keep continuous time).
 */
export function reanchorPlaybackAtNow(state: RoomState, nowMs = Date.now()) {
  state.playback.timelineAnchorMs = resolveCurrentTimelineMs(state, nowMs)
  state.playback.serverNowMs = nextMonotonicMs(state.playback.serverNowMs, nowMs)
}

/**
 * Snap the playhead to 0 and advance the monotonic clock (playlist item
 * change, empty playlist, ingest-error advance).
 */
export function resetPlaybackTimeline(
  state: RoomState,
  nowMs = Date.now(),
  options?: { pause?: boolean },
) {
  state.playback.timelineAnchorMs = 0
  state.playback.serverNowMs = nextMonotonicMs(state.playback.serverNowMs, nowMs)
  if (options?.pause) {
    state.playback.paused = true
  }
}

export function getCurrentMediaId(state: RoomState) {
  return state.playlist[state.currentIndex]?.id
}

export function markCurrentMedia(state: RoomState): void {
  state.playback.mediaId = getCurrentMediaId(state)
}

/** Bump optimistic-lock / snapshot revision counters after a structural write. */
export function bumpRoomRevisions(state: RoomState): void {
  state.generation = (state.generation ?? 0) + 1
  state.structuralRevision = (state.structuralRevision ?? 0) + 1
}
