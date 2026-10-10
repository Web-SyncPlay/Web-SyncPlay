import type { TypedRoomEventSender } from "@/contracts/room-events"
import type { ClientRoomState } from "@/contracts/types"

/** Playlist + playback only — presence must stay off control actions. */
export type PlayerNavRoomState = Pick<
  ClientRoomState,
  "playback" | "currentIndex" | "playlist"
>

export interface PlaybackControlContext {
  roomState: PlayerNavRoomState
  send: TypedRoomEventSender
  controlsDisabled: boolean
  elapsedMs: number
}
