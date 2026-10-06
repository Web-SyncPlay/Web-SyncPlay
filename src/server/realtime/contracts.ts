import type { ClientEventType } from "@/lib/room-events"
import {
  localMediaChunkSchema,
  localMediaReadySchema,
  participantRoleUpdateSchema,
  participantUpdateSchema,
  playbackLoopModeSchema,
  playbackRateSchema,
  playbackSeekSchema,
  playbackSetPausedSchema,
  playlistAddLocalSchema,
  playlistAddUrlSchema,
  playlistItemErrorSchema,
  playlistRemoveSchema,
  playlistRenameSchema,
  playlistReorderSchema,
  playlistRetrySchema,
  playlistSelectSchema,
  roomJoinSchema,
  roomPasswordClearSchema,
  roomPasswordSetSchema,
  roomDefaultRoleSetSchema,
  seekPreviewSchema,
  viewerMediaPreferencesSchema,
  wsEnvelopeSchema,
} from "@/zod/schemas"
import type { z } from "zod"

/**
 * Payload schema for every client→server room message (excluding join).
 * Keep this map and {@link ClientEventPayloadMap} / handler registry in lockstep.
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
  "local-media:chunk": localMediaChunkSchema,
  "local-media:ready": localMediaReadySchema,
  "viewer:media:preferences": viewerMediaPreferencesSchema,
  "playlist:rename": playlistRenameSchema,
  "playlist:remove": playlistRemoveSchema,
  "playlist:reorder": playlistReorderSchema,
  "playlist:select": playlistSelectSchema,
  "seek:preview": seekPreviewSchema,
  "room:password:set": roomPasswordSetSchema,
  "room:password:clear": roomPasswordClearSchema,
  "room:default-role:set": roomDefaultRoleSetSchema,
} as const satisfies Record<ClientEventType, z.ZodType>

export type RoomMessageSchemaMap = typeof roomMessageSchemas

/** Join is handled before the room-message registry. */
export const joinMessageSchema = roomJoinSchema

export const transportEnvelopeSchema = wsEnvelopeSchema

export const roomMessageEventTypes = Object.keys(
  roomMessageSchemas,
) as ClientEventType[]
