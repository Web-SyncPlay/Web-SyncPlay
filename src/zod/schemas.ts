import { z } from "zod"

const roomRoleSchema = z.enum(["owner", "moderator", "guest"])

export const sessionKindSchema = z.enum(["room", "player", "control"])

export const roomJoinSchema = z.object({
  roomId: z.string().min(1),
  userId: z.string().min(1).optional(),
  userSecret: z.string().min(1),
  joinPassword: z.string().min(1).max(256).optional(),
  username: z.string().min(1).max(64).optional(),
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

export const defaultJoinRoleSchema = z.enum(["moderator", "guest"])

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
  mode: z.enum(["off", "always", "once"]),
})

export const playlistSelectSchema = z.object({
  index: z.number().int().min(0),
})

export const playlistReorderSchema = z.object({
  from: z.number().int().min(0),
  to: z.number().int().min(0),
})

export const playlistRenameSchema = z.object({
  itemId: z.string().min(1),
  name: z.string().min(1).max(256),
})

export const playlistRemoveSchema = z.object({
  itemId: z.string().min(1),
})

export const playlistAddUrlSchema = z.object({
  url: z.url(),
})

export const playlistAddLocalSchema = z.object({
  localMediaId: z.string().uuid(),
  name: z.string().min(1).max(256),
  mimeType: z.string().min(1).max(128),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(1024 * 1024 * 1024 * 1024), // 1 TiB sanity bound (bytes stay on provider)
})

export const localMediaChunkSchema = z.object({
  requestId: z.string().min(1),
  ok: z.boolean(),
  dataBase64: z.string().min(1).optional(),
  error: z.string().max(300).optional(),
})

export const localMediaReadySchema = z.object({
  localMediaId: z.string().uuid(),
  ready: z.boolean(),
})

export const localMediaAbrPublishSchema = z.object({
  parentLocalMediaId: z.string().uuid(),
  durationSec: z.number().positive().max(60 * 60 * 24),
  variants: z
    .array(
      z.object({
        localMediaId: z.string().uuid(),
        height: z.number().int().min(1).max(16_384),
        bandwidth: z.number().int().min(1).max(500_000_000),
        label: z.string().min(1).max(64),
        mimeType: z.string().min(1).max(128),
        sizeBytes: z
          .number()
          .int()
          .min(1)
          .max(1024 * 1024 * 1024 * 1024),
        name: z.string().min(1).max(256),
      }),
    )
    .min(1)
    .max(8),
})

/** WebRTC signaling for local-media P2P / SFU bootstrap (relayed by server). */
export const localMediaWebrtcSignalSchema = z.object({
  localMediaId: z.string().uuid(),
  targetUserId: z.string().min(1).max(128),
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
  localMediaId: z.string().uuid().optional(),
})

export const localMediaSfuConnectTransportSchema = z.object({
  transportId: z.string().min(1).max(128),
  dtlsParameters: sfuDtlsParametersSchema,
})

export const localMediaSfuProduceDataSchema = z.object({
  transportId: z.string().min(1).max(128),
  localMediaId: z.string().uuid(),
  sctpStreamParameters: sfuSctpStreamParametersSchema,
  label: z.string().max(128).optional(),
  protocol: z.string().max(128).optional(),
  /** `provider` serves blocks; `requests` is a viewer→provider request channel. */
  role: z.enum(["provider", "requests"]).optional(),
})

export const localMediaSfuConsumeDataSchema = z.object({
  transportId: z.string().min(1).max(128),
  localMediaId: z.string().uuid(),
  /** Consume a specific viewer request channel instead of the provider block channel. */
  dataProducerId: z.string().min(1).max(128).optional(),
})

export const playlistRetrySchema = z.object({
  itemId: z.string().min(1),
})

export const playlistItemErrorSchema = z.object({
  itemId: z.string().min(1),
  /** `null` clears a previously reported ingest error after recovery. */
  error: z.string().min(1).max(300).nullable(),
})

export const viewerMediaPreferencesSchema = z.object({
  itemId: z.string().min(1),
  streamId: z.string().min(1).nullable().optional(),
  textTrackId: z.string().min(1).nullable().optional(),
  audioLanguage: z.string().min(1).max(32).optional(),
})

export const participantUpdateSchema = z.object({
  username: z.string().min(1).max(64).optional(),
  avatarStyle: z.string().min(1).max(64).optional(),
  paused: z.boolean().optional(),
  currentTimeMs: z.number().min(0).optional(),
  loading: z.boolean().optional(),
  /** `null` clears a previously reported local playback error. */
  error: z.string().max(300).nullable().optional(),
})

export const participantRoleUpdateSchema = z.object({
  targetUserId: z.string().min(1),
  role: roomRoleSchema,
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
