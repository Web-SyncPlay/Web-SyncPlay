import {
  defaultJoinRoleSchema,
  loopModeSchema,
  roomErrorCodeSchema,
  roomJoinRejectedReasonSchema,
  roomRoleSchema,
  sessionCapabilitiesSchema,
} from "@/contracts/schemas"
import { z } from "zod"

/**
 * Server→client envelope payload schemas for critical room bus events.
 * Mirror {@link RoomControlPayload} / presence / snapshot / admission / join reject.
 */

const playbackStateSchema = z.object({
  mediaId: z.string().min(1).optional(),
  paused: z.boolean(),
  playbackRate: z.number(),
  timelineAnchorMs: z.number(),
  serverNowMs: z.number(),
  videoLoop: loopModeSchema,
  playlistLoop: loopModeSchema,
  seekPreview: z
    .object({
      userId: z.string().min(1),
      targetMs: z.number(),
      active: z.boolean(),
      updatedAt: z.number(),
    })
    .optional(),
})

const publicRoomSecuritySchema = z.object({
  joinPasswordEnabled: z.boolean(),
  joinPasswordUpdatedAt: z.number().nullable(),
  admissionVersion: z.number().int().nonnegative(),
  defaultJoinRole: defaultJoinRoleSchema,
})

const localPlaybackSchema = z.object({
  paused: z.boolean(),
  currentTimeMs: z.number(),
  loading: z.boolean(),
  error: z.string().optional(),
  updatedAt: z.number(),
})

const participantStateSchema = z.object({
  userId: z.string().min(1),
  username: z.string(),
  avatarStyle: z.string(),
  role: roomRoleSchema,
  connected: z.boolean(),
  joinedAt: z.number().optional(),
  connectedAt: z.number().optional(),
  disconnectedAt: z.number().optional(),
  lastSeenAt: z.number().optional(),
  localPlayback: localPlaybackSchema,
  viewerMedia: z
    .object({
      byItemId: z.record(z.string(), z.record(z.string(), z.unknown())),
    })
    .optional(),
})

const presencePatchSchema = z.object({
  connected: z.boolean().optional(),
  lastSeenAt: z.number().optional(),
  disconnectedAt: z.number().optional(),
  username: z.string().optional(),
  avatarStyle: z.string().optional(),
  localPlayback: localPlaybackSchema.optional(),
})

/** Playlist item: validate catalog-critical fields; allow extra keys. */
const playlistItemSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    sourceKind: z.enum(["remote_url", "local_file"]),
    playbackMode: z.enum(["direct", "relay"]),
    sourceUrl: z.string(),
    playableUrl: z.string(),
    createdBy: z.string(),
    createdAt: z.number(),
  })
  .passthrough()

const actionLogEntrySchema = z
  .object({
    id: z.string().min(1),
    at: z.number(),
    roomId: z.string().min(1),
    actorUserId: z.string().min(1),
    action: z.string(),
    payload: z.record(z.string(), z.unknown()),
  })
  .passthrough()

export const roomControlPayloadSchema = z.object({
  generation: z.number().int().nonnegative(),
  playback: playbackStateSchema,
  currentIndex: z.number().int().nonnegative(),
  updatedAt: z.number(),
})

export const presenceBatchPayloadSchema = z.object({
  presenceRevision: z.number().int().nonnegative(),
  participants: z.record(z.string(), presencePatchSchema),
  serverNowMs: z.number(),
})

export const roomSnapshotPayloadSchema = z.object({
  roomId: z.string().min(1),
  ownerId: z.string().min(1),
  roomSecurity: publicRoomSecuritySchema,
  playback: playbackStateSchema,
  playlist: z.array(playlistItemSchema),
  currentIndex: z.number().int().nonnegative(),
  participants: z.record(z.string(), participantStateSchema),
  actionLog: z.array(actionLogEntrySchema),
  updatedAt: z.number(),
  generation: z.number().int().nonnegative(),
  structuralRevision: z.number().int().nonnegative(),
  presenceRevision: z.number().int().nonnegative().optional(),
})

export const admissionChangedPayloadSchema = z.object({
  admissionVersion: z.number().int().nonnegative(),
  ownerId: z.string().min(1),
  joinPasswordEnabled: z.boolean(),
})

/** Capabilities plus optional local-media viewer token mint. */
export const sessionCapabilitiesPayloadSchema = sessionCapabilitiesSchema.extend(
  {
    viewerToken: z.string().min(1).optional(),
  },
)

export const roomJoinRejectedPayloadSchema = z.object({
  reason: roomJoinRejectedReasonSchema,
})

/** Mutation nack: correlates to the client `requestId` on the failed C2S command. */
export const roomErrorPayloadSchema = z.object({
  code: roomErrorCodeSchema,
  /** Echo of the failed client event type when known. */
  type: z.string().min(1).optional(),
  message: z.string().max(300).optional(),
})

/**
 * Payload schema for every critical server→client room message.
 * Source of truth for inbound wire shapes — {@link ServerEventPayloadMap} is derived.
 */
export const serverEventSchemas = {
  "room:control": roomControlPayloadSchema,
  "presence:batch": presenceBatchPayloadSchema,
  "room:snapshot": roomSnapshotPayloadSchema,
  /** Legacy alias still emitted during join race windows. */
  "room:state": roomSnapshotPayloadSchema,
  "room:admission:changed": admissionChangedPayloadSchema,
  "session:capabilities": sessionCapabilitiesPayloadSchema,
  "room:join:rejected": roomJoinRejectedPayloadSchema,
  "room:error": roomErrorPayloadSchema,
} as const

export type ServerEventSchemaMap = typeof serverEventSchemas
export type ServerEventType = keyof ServerEventSchemaMap

export type ServerEventPayloadMap = {
  [K in keyof ServerEventSchemaMap]: z.infer<ServerEventSchemaMap[K]>
}
