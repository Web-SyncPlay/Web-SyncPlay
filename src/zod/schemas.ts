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

export const playlistRetrySchema = z.object({
  itemId: z.string().min(1),
})

export const playlistItemErrorSchema = z.object({
  itemId: z.string().min(1),
  error: z.string().min(1).max(300),
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
  error: z.string().max(300).optional(),
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
