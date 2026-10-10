import type { TypedRoomEventSender } from "@/contracts/room-events"
import type { RoomState } from "@/contracts/types"

/** Playlist + playback only — presence must stay off control actions. */
export type PlayerNavRoomState = Pick<
  RoomState,
  "playback" | "currentIndex" | "playlist"
>

export interface PlaybackControlContext {
  roomState: PlayerNavRoomState
  send: TypedRoomEventSender
  controlsDisabled: boolean
  elapsedMs: number
}
