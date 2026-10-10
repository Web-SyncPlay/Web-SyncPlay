import type {
  AdmissionChangedPayload,
  PresenceBatchPayload,
  RoomControlPayload,
  RoomSnapshotPayload,
  WsEnvelope,
} from "@/contracts/types"

/** Hint for mutateRoomMessage post-write publish path. */
export type RoomPublishHint =
  | { kind: "control" }
  /** No bus publish (caller uses publishControlEphemeral directly). */
  | { kind: "control-ephemeral" }
  | { kind: "presence" }
  | { kind: "snapshot" }
  | { kind: "control+snapshot" }
  | { kind: "action-log" }

export type ControlEnvelope = WsEnvelope<"room:control", RoomControlPayload>
export type PresenceEnvelope = WsEnvelope<"presence:batch", PresenceBatchPayload>
export type SnapshotEnvelope = WsEnvelope<"room:snapshot", RoomSnapshotPayload>
export type AdmissionChangedEnvelope = WsEnvelope<
  "room:admission:changed",
  AdmissionChangedPayload
>

export type RoomBroadcastEnvelope =
  | ControlEnvelope
  | PresenceEnvelope
  | SnapshotEnvelope
  | AdmissionChangedEnvelope
