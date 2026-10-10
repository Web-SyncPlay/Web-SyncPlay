import {
  defaultJoinRoleSchema,
  localMediaIdSchema,
  loopModeSchema,
  roomErrorCodeSchema,
  roomJoinRejectedReasonSchema,
  roomRoleSchema,
  sessionCapabilitiesSchema,
  userIdSchema,
} from "@/contracts/schemas"
import { z } from "zod"

/**
 * Server→client envelope payload schemas for critical room bus events.
 * Domain playlist/participant/playback shapes are defined here and re-exported
 * as `z.infer` types from {@link ./types} so wire validation and TS cannot drift.
 */

export const playlistSourceKindSchema = z.enum(["remote_url", "local_file"])
export const playbackModeSchema = z.enum(["direct", "relay"])
export const ingestStatusSchema = z.enum(["ready", "resolving", "error"])
export const playlistBlockedReasonSchema = z.enum(["local_owner_offline"])
export const playlistMediaStreamKindSchema = z.enum(["adaptive", "combined"])

export const playlistMediaStreamSchema = z.object({
  id: z.string().min(1),
  src: z.string(),
  type: z.string().optional(),
  protocol: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  bitrate: z.number().optional(),
  audioBitrate: z.number().optional(),
  label: z.string().optional(),
  isDefault: z.boolean().optional(),
  kind: playlistMediaStreamKindSchema.optional(),
  vcodec: z.string().optional(),
  acodec: z.string().optional(),
  audioLanguage: z.string().optional(),
})

export const playlistTextTrackSchema = z.object({
  id: z.string().min(1),
  src: z.string(),
  label: z.string(),
  language: z.string().optional(),
  kind: z
    .enum(["captions", "subtitles", "chapters", "descriptions", "metadata"])
    .optional(),
  type: z.string().optional(),
  isDefault: z.boolean().optional(),
})

/** Full playlist catalog item — no passthrough; unknown keys are stripped. */
export const playlistItemSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  sourceKind: playlistSourceKindSchema,
  playbackMode: playbackModeSchema,
  sourceUrl: z.string(),
  playableUrl: z.string(),
  durationSeconds: z.number().optional(),
  ingestStatus: ingestStatusSchema.optional(),
  ingestError: z.string().optional(),
  blockedReason: playlistBlockedReasonSchema.optional(),
  mediaStreams: z.array(playlistMediaStreamSchema).optional(),
  textTracks: z.array(playlistTextTrackSchema).optional(),
  /** Resolve-time catalog default (not room-wide viewer selection). */
  defaultStreamId: z.string().optional(),
  /** Resolve-time catalog default caption (not room-wide viewer selection). */
  defaultTextTrackId: z.string().optional(),
  /** From yt-dlp when resolve succeeds (live broadcast vs VOD). */
  isLive: z.boolean().optional(),
  localMediaId: localMediaIdSchema.optional(),
  localOriginUserId: userIdSchema.optional(),
  localMimeType: z.string().optional(),
  localSizeBytes: z.number().optional(),
  createdBy: z.string(),
  createdAt: z.number(),
})

/** Per-item viewer preference stored on participant state (S2C). */
export const viewerMediaItemPreferenceSchema = z.object({
  streamId: z.string().optional(),
  textTrackId: z.string().nullable().optional(),
  audioLanguage: z.string().optional(),
})

export const viewerMediaPreferencesStateSchema = z.object({
  byItemId: z.record(z.string(), viewerMediaItemPreferenceSchema),
})

export const playbackStateSchema = z.object({
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

export const publicRoomSecuritySchema = z.object({
  joinPasswordEnabled: z.boolean(),
  joinPasswordUpdatedAt: z.number().nullable(),
  admissionVersion: z.number().int().nonnegative(),
  defaultJoinRole: defaultJoinRoleSchema,
})

export const localPlaybackSchema = z.object({
  paused: z.boolean(),
  currentTimeMs: z.number(),
  loading: z.boolean(),
  error: z.string().optional(),
  updatedAt: z.number(),
})

export const participantStateSchema = z.object({
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
  viewerMedia: viewerMediaPreferencesStateSchema.optional(),
})

/**
 * Client-facing presence patch fields (S2C).
 * Server Redis patches may also carry `localPlaybackReports` (stripped before
 * broadcast) — that extension lives on {@link PresencePatch} in types.ts, not here.
 */
export const presencePatchSchema = z.object({
  connected: z.boolean().optional(),
  lastSeenAt: z.number().optional(),
  disconnectedAt: z.number().optional(),
  username: z.string().optional(),
  avatarStyle: z.string().optional(),
  localPlayback: localPlaybackSchema.optional(),
})

/** Action log entry — known optional fields listed; unknown keys stripped. */
export const actionLogEntrySchema = z.object({
  id: z.string().min(1),
  at: z.number(),
  roomId: z.string().min(1),
  actorUserId: z.string().min(1),
  actorUsername: z.string().optional(),
  action: z.string(),
  payload: z.record(z.string(), z.unknown()),
  error: z.string().optional(),
})

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

/** SFU request correlation reply (ok + optional fields / error). */
export const localMediaSfuResultPayloadSchema = z
  .object({
    ok: z.boolean(),
    error: z.string().max(300).optional(),
  })
  .passthrough()

export const localMediaSfuProducerPayloadSchema = z.object({
  localMediaId: localMediaIdSchema,
  dataProducerId: z.string().min(1).max(128),
  ownerUserId: userIdSchema,
  kind: z.enum(["provider", "requests"]).optional(),
})

export const localMediaSfuUnavailablePayloadSchema = z.object({
  error: z.string().max(300).optional(),
})

/** Peer-facing WebRTC signal (fromUserId set by server relay). */
export const localMediaWebrtcSignalS2cPayloadSchema = z.object({
  localMediaId: localMediaIdSchema,
  fromUserId: userIdSchema,
  signal: z.object({
    type: z.enum(["offer", "answer", "ice", "hangup"]),
    sdp: z.string().max(256_000).optional(),
    candidate: z.string().max(8_000).optional(),
    sdpMid: z.string().max(64).optional(),
    sdpMLineIndex: z.number().int().min(0).max(64).optional(),
  }),
})

/** HTTP-relay range read request delivered to a provider tab. */
export const localMediaReadPayloadSchema = z.object({
  requestId: z.string().min(1).max(128),
  localMediaId: localMediaIdSchema,
  start: z.number().int().min(0),
  end: z.number().int().min(0),
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
  "local-media:sfu:result": localMediaSfuResultPayloadSchema,
  "local-media:sfu:producer": localMediaSfuProducerPayloadSchema,
  "local-media:sfu:unavailable": localMediaSfuUnavailablePayloadSchema,
  "local-media:webrtc:signal": localMediaWebrtcSignalS2cPayloadSchema,
  "local-media:read": localMediaReadPayloadSchema,
} as const

export type ServerEventSchemaMap = typeof serverEventSchemas
export type ServerEventType = keyof ServerEventSchemaMap

export type ServerEventPayloadMap = {
  [K in keyof ServerEventSchemaMap]: z.infer<ServerEventSchemaMap[K]>
}
