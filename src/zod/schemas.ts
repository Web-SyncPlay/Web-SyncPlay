import {
  sanitizeErrorMessage,
  sanitizeMediaTitle,
  sanitizeUsername,
} from "@/lib/sanitize-display"
import { z } from "zod"

/** Shared id / size primitives (keep bounds consistent across client events). */
const userIdSchema = z.string().min(1).max(128)
const itemIdSchema = z.string().min(1).max(128)
const localMediaIdSchema = z.string().uuid()
const sizeBytesSchema = z
  .number()
  .int()
  .min(1)
  .max(1024 * 1024 * 1024 * 1024) // 1 TiB sanity bound

export const roomRoleSchema = z.enum(["owner", "moderator", "guest"])
export const loopModeSchema = z.enum(["off", "once", "always"])
export const defaultJoinRoleSchema = roomRoleSchema.exclude(["owner"])
export const sessionKindSchema = z.enum(["room", "player", "control"])

/** Reject XSS-packaged / control-laden usernames; NFC + strip markup delimiters. */
const usernameSchema = z
  .string()
  .max(64)
  .refine((value) => sanitizeUsername(value) !== null, {
    message: "invalid_username",
  })
  .transform((value) => sanitizeUsername(value)!)

/** Media / playlist display names (strip markup; allow unicode). */
const mediaTitleSchema = z
  .string()
  .max(256)
  .refine((value) => sanitizeMediaTitle(value) !== null, {
    message: "invalid_media_title",
  })
  .transform((value) => sanitizeMediaTitle(value)!)

/** Short UI labels (quality rungs, etc.). */
const shortLabelSchema = z
  .string()
  .max(64)
  .refine((value) => {
    const next = sanitizeMediaTitle(value)
    return next !== null && next.length <= 64
  }, { message: "invalid_label" })
  .transform((value) => sanitizeMediaTitle(value)!.slice(0, 64))

/** Client-reported errors shown in UI / action log. */
const errorMessageSchema = z
  .string()
  .max(300)
  .refine((value) => sanitizeErrorMessage(value) !== null, {
    message: "invalid_error_message",
  })
  .transform((value) => sanitizeErrorMessage(value)!)

export const roomJoinSchema = z.object({
  roomId: z.string().min(1).max(128),
  userId: userIdSchema.optional(),
  userSecret: z.string().min(1),
  joinPassword: z.string().min(1).max(256).optional(),
  username: usernameSchema.optional(),
  /** Resolved server-side via `resolveStyle` (unknown → default). */
  avatarStyle: z.string().min(1).max(64).optional(),
  sessionKind: sessionKindSchema.default("room"),
  controlToken: z.string().min(1).max(512).optional(),
  /** Used only when the room is created by this join; ignored for existing rooms. */
  initialMediaUrl: z.url().optional(),
})

export const roomPasswordSetSchema = z.object({
  password: z.string().min(1).max(256),
})

export const roomPasswordClearSchema = z.object({})

export const roomDefaultRoleSetSchema = z.object({
  role: defaultJoinRoleSchema,
})

export const playbackSeekSchema = z.object({
  targetMs: z
    .number()
    .min(0)
    .max(1000 * 60 * 60 * 24),
})

export const playbackRateSchema = z.object({
  playbackRate: z.number().min(0.25).max(3),
})

export const playbackSetPausedSchema = z.object({
  currentTimeMs: z.number().min(0).optional(),
})

export const playbackLoopModeSchema = z.object({
  mode: loopModeSchema,
})

export const playlistSelectSchema = z.object({
  index: z.number().int().min(0),
})

export const playlistReorderSchema = z.object({
  from: z.number().int().min(0),
  to: z.number().int().min(0),
})

export const playlistRenameSchema = z.object({
  itemId: itemIdSchema,
  name: mediaTitleSchema,
})

export const playlistRemoveSchema = z.object({
  itemId: itemIdSchema,
})

export const playlistAddUrlSchema = z.object({
  url: z.url(),
})

export const playlistAddLocalSchema = z.object({
  localMediaId: localMediaIdSchema,
  name: mediaTitleSchema,
  mimeType: z.string().min(1).max(128),
  sizeBytes: sizeBytesSchema,
  /** Optional early probe from the provider browser (before ABR publish). */
  durationSeconds: z.number().positive().max(60 * 60 * 24).optional(),
})

export const localMediaChunkSchema = z.object({
  requestId: z.string().min(1).max(128),
  ok: z.boolean(),
  dataBase64: z.string().min(1).optional(),
  error: errorMessageSchema.optional(),
})

export const localMediaReadySchema = z.object({
  localMediaId: localMediaIdSchema,
  ready: z.boolean(),
})

export const localMediaAbrPublishSchema = z.object({
  parentLocalMediaId: localMediaIdSchema,
  durationSec: z.number().positive().max(60 * 60 * 24),
  variants: z
    .array(
      z.object({
        localMediaId: localMediaIdSchema,
        height: z.number().int().min(1).max(16_384),
        bandwidth: z.number().int().min(1).max(500_000_000),
        label: shortLabelSchema,
        mimeType: z.string().min(1).max(128),
        sizeBytes: sizeBytesSchema,
        name: mediaTitleSchema,
      }),
    )
    .min(1)
    .max(8),
})

/** WebRTC signaling for local-media P2P / SFU bootstrap (relayed by server). */
export const localMediaWebrtcSignalSchema = z.object({
  localMediaId: localMediaIdSchema,
  targetUserId: userIdSchema,
  signal: z.object({
    type: z.enum(["offer", "answer", "ice", "hangup"]),
    sdp: z.string().max(256_000).optional(),
    candidate: z.string().max(8_000).optional(),
    sdpMid: z.string().max(64).optional(),
    sdpMLineIndex: z.number().int().min(0).max(64).optional(),
  }),
})

const sfuSctpStreamParametersSchema = z.object({
  streamId: z.number().int().min(0).max(65_535),
  ordered: z.boolean().optional(),
  maxPacketLifeTime: z.number().int().min(0).max(65_535).optional(),
  maxRetransmits: z.number().int().min(0).max(65_535).optional(),
})

const sfuDtlsParametersSchema = z.object({
  role: z.enum(["auto", "client", "server"]).optional(),
  fingerprints: z
    .array(
      z.object({
        algorithm: z.string().min(1).max(32),
        value: z.string().min(1).max(256),
      }),
    )
    .min(1)
    .max(8),
})

export const localMediaSfuCapabilitiesSchema = z.object({})

export const localMediaSfuCreateTransportSchema = z.object({
  direction: z.enum(["send", "recv"]),
  localMediaId: localMediaIdSchema.optional(),
})

export const localMediaSfuConnectTransportSchema = z.object({
  transportId: z.string().min(1).max(128),
  dtlsParameters: sfuDtlsParametersSchema,
})

export const localMediaSfuProduceDataSchema = z.object({
  transportId: z.string().min(1).max(128),
  localMediaId: localMediaIdSchema,
  sctpStreamParameters: sfuSctpStreamParametersSchema,
  label: z.string().max(128).optional(),
  protocol: z.string().max(128).optional(),
  /** `provider` serves blocks; `requests` is a viewer→provider request channel. */
  role: z.enum(["provider", "requests"]).optional(),
})

export const localMediaSfuConsumeDataSchema = z.object({
  transportId: z.string().min(1).max(128),
  localMediaId: localMediaIdSchema,
  /** Consume a specific viewer request channel instead of the provider block channel. */
  dataProducerId: z.string().min(1).max(128).optional(),
})

export const playlistRetrySchema = z.object({
  itemId: itemIdSchema,
})

export const playlistItemErrorSchema = z.object({
  itemId: itemIdSchema,
  /** `null` clears a previously reported ingest error after recovery. */
  error: errorMessageSchema.nullable(),
})

/** Player-observed VOD duration write-back into the playlist catalog. */
export const playlistItemDurationSchema = z.object({
  itemId: itemIdSchema,
  durationSeconds: z.number().positive().max(60 * 60 * 24),
})

export const viewerMediaPreferencesSchema = z.object({
  itemId: itemIdSchema,
  streamId: z.string().min(1).max(128).nullable().optional(),
  textTrackId: z.string().min(1).max(128).nullable().optional(),
  audioLanguage: z.string().min(1).max(32).optional(),
})

export const participantUpdateSchema = z.object({
  username: usernameSchema.optional(),
  /** Resolved server-side via `resolveStyle` (unknown → default). */
  avatarStyle: z.string().min(1).max(64).optional(),
  paused: z.boolean().optional(),
  currentTimeMs: z.number().min(0).optional(),
  loading: z.boolean().optional(),
  /** `null` or `""` clears a previously reported local playback error. */
  error: z.preprocess(
    (value) => (value === "" ? null : value),
    errorMessageSchema.nullable().optional(),
  ),
})

export const participantRoleUpdateSchema = z.object({
  targetUserId: userIdSchema,
  /** Assignable roles only — ownership transfers via disconnect/cleanup, not this event. */
  role: defaultJoinRoleSchema,
})

export const seekPreviewSchema = z.object({
  targetMs: z.number().min(0).optional(),
  active: z.boolean().optional(),
})

export const wsEnvelopeSchema = z.object({
  type: z.string().min(1),
  requestId: z.string().min(1).optional(),
  sourceUserId: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown()),
})
