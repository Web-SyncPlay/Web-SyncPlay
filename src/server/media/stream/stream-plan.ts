import { hostRequiresMediaRelay } from "@/server/media/stream/requires-relay"

export type StreamPlanInput = {
  playableUrl: string
  /** Original page/share URL — used when the CDN host alone is not enough. */
  sourceUrl?: string
  isNativeProvider: boolean
  corsAllowed: boolean
}

export function buildStreamPlan(input: StreamPlanInput): {
  playbackMode: "direct" | "relay"
} {
  if (input.isNativeProvider) {
    return { playbackMode: "direct" }
  }
  if (
    hostRequiresMediaRelay(input.playableUrl) ||
    (input.sourceUrl !== undefined && hostRequiresMediaRelay(input.sourceUrl))
  ) {
    return { playbackMode: "relay" }
  }
  if (input.corsAllowed) {
    return { playbackMode: "direct" }
  }
  return { playbackMode: "relay" }
}
