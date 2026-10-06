import type {
  PresenceBatchPayload,
  RoomControlPayload,
  RoomSnapshotPayload,
  WsEnvelope,
} from "@/zod/types"

export type RoomPublishHint =
  | { kind: "control" }
  | { kind: "control-ephemeral" }
  | { kind: "presence" }
  | { kind: "snapshot" }
  | { kind: "control+snapshot" }
  | { kind: "action-log" }

export type ControlEnvelope = WsEnvelope<"room:control", RoomControlPayload>
export type PresenceEnvelope = WsEnvelope<"presence:batch", PresenceBatchPayload>
export type SnapshotEnvelope = WsEnvelope<"room:snapshot", RoomSnapshotPayload>

export type RoomBroadcastEnvelope =
  | ControlEnvelope
  | PresenceEnvelope
  | SnapshotEnvelope
