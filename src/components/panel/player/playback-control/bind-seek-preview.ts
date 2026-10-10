/**
 * Shared scrub binder for PlayerPanel / ControlClient.
 * End-scrub (`active: false`) is ignored — commit via `playback:seek`.
 */
export function bindSeekPreview(timeline: {
  seekPhase: string
  beginSeek: (targetMs: number) => void
  updateSeek: (targetMs: number) => void
}): (targetMs: number, active: boolean) => void {
  return (targetMs, active) => {
    if (!active) {
      return
    }
    if (timeline.seekPhase === "idle") {
      timeline.beginSeek(targetMs)
      return
    }
    timeline.updateSeek(targetMs)
  }
}
