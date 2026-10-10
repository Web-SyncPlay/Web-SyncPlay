import {
  localMediaAbrPublishSchema,
  localMediaChunkSchema,
  localMediaReadySchema,
  localMediaSfuCapabilitiesSchema,
  localMediaSfuConnectTransportSchema,
  localMediaSfuConsumeDataSchema,
  localMediaSfuCreateTransportSchema,
  localMediaSfuProduceDataSchema,
  localMediaWebrtcSignalSchema,
  participantRoleUpdateSchema,
  participantUpdateSchema,
  playbackLoopModeSchema,
  playbackRateSchema,
  playbackSeekSchema,
  playbackSetPausedSchema,
  playlistAddLocalSchema,
  playlistAddUrlSchema,
  playlistItemDurationSchema,
  playlistItemErrorSchema,
  playlistRemoveSchema,
  playlistRenameSchema,
  playlistReorderSchema,
  playlistRetrySchema,
  playlistSelectSchema,
  roomDefaultRoleSetSchema,
  roomPasswordClearSchema,
  roomPasswordSetSchema,
  seekPreviewSchema,
  viewerMediaPreferencesSchema,
} from "@/contracts/schemas"
import type { SessionKind } from "@/contracts/types"
import type { z } from "zod"

/**
 * Payload schema for every client→server room message (excluding join).
 * Source of truth for wire shapes — {@link ClientEventPayloadMap} is derived via z.infer.
 */
export const roomMessageSchemas = {
  "participant:update": participantUpdateSchema,
  "participant:role:update": participantRoleUpdateSchema,
  "playback:play": playbackSetPausedSchema,
  "playback:pause": playbackSetPausedSchema,
  "playback:seek": playbackSeekSchema,
  "playback:rate": playbackRateSchema,
  "playback:loop:video": playbackLoopModeSchema,
  "playback:loop:playlist": playbackLoopModeSchema,
  "playlist:add:url": playlistAddUrlSchema,
  "playlist:add:local": playlistAddLocalSchema,
  "playlist:retry": playlistRetrySchema,
  "playlist:item:error": playlistItemErrorSchema,
  "playlist:item:duration": playlistItemDurationSchema,
  "local-media:chunk": localMediaChunkSchema,
  "local-media:ready": localMediaReadySchema,
  "local-media:abr:publish": localMediaAbrPublishSchema,
  "local-media:webrtc:signal": localMediaWebrtcSignalSchema,
  "local-media:sfu:capabilities": localMediaSfuCapabilitiesSchema,
  "local-media:sfu:create-transport": localMediaSfuCreateTransportSchema,
  "local-media:sfu:connect-transport": localMediaSfuConnectTransportSchema,
  "local-media:sfu:produce-data": localMediaSfuProduceDataSchema,
  "local-media:sfu:consume-data": localMediaSfuConsumeDataSchema,
  "viewer:media:preferences": viewerMediaPreferencesSchema,
  "playlist:rename": playlistRenameSchema,
  "playlist:remove": playlistRemoveSchema,
  "playlist:reorder": playlistReorderSchema,
  "playlist:select": playlistSelectSchema,
  "seek:preview": seekPreviewSchema,
  "room:password:set": roomPasswordSetSchema,
  "room:password:clear": roomPasswordClearSchema,
  "room:default-role:set": roomDefaultRoleSetSchema,
} as const

export type RoomMessageSchemaMap = typeof roomMessageSchemas

/** Inferred from {@link roomMessageSchemas} so client send types cannot drift from zod. */
export type ClientEventPayloadMap = {
  [K in keyof RoomMessageSchemaMap]: z.infer<RoomMessageSchemaMap[K]>
}

export type ClientEventType = keyof ClientEventPayloadMap

export type TypedRoomEventSender = <T extends ClientEventType>(
  type: T,
  payload: ClientEventPayloadMap[T],
) => void

export type { SessionKind }
