/** Room playback fields used to build a pending sync snapshot. */
export type PendingSyncPlaybackInput = {
  paused: boolean
  playbackRate: number
  timelineAnchorMs: number
  serverNowMs: number
  videoLoop: string | boolean
}

/** Sync snapshot applied after remount / recovery / drift correction. */
export type PendingSyncState = {
  paused: boolean
  playbackRate: number
  timelineAnchorMs: number
  serverNowMs: number
  videoLoop: boolean
}

/** Build pending sync from room playback (string or boolean loop field). */
export function pendingSyncFromPlayback(
  playback: PendingSyncPlaybackInput,
): PendingSyncState {
  return {
    paused: playback.paused,
    playbackRate: playback.playbackRate,
    timelineAnchorMs: playback.timelineAnchorMs,
    serverNowMs: playback.serverNowMs,
    videoLoop:
      typeof playback.videoLoop === "boolean"
        ? playback.videoLoop
        : playback.videoLoop !== "off",
  }
}
