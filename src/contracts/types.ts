import type {
  actionLogEntrySchema,
  admissionChangedPayloadSchema,
  ingestStatusSchema,
  localPlaybackSchema,
  participantStateSchema,
  playbackModeSchema,
  playbackStateSchema,
  playlistBlockedReasonSchema,
  playlistItemSchema,
  playlistMediaStreamKindSchema,
  playlistMediaStreamSchema,
  playlistSourceKindSchema,
  playlistTextTrackSchema,
  presenceBatchPayloadSchema,
  presencePatchSchema,
  publicRoomSecuritySchema,
  roomControlPayloadSchema,
  roomSnapshotPayloadSchema,
  viewerMediaItemPreferenceSchema,
  viewerMediaPreferencesStateSchema,
} from "@/contracts/s2c"
import type {
  defaultJoinRoleSchema,
  loopModeSchema,
  roomJoinRejectedReasonSchema,
  roomRoleSchema,
  sessionCapabilitiesSchema,
  sessionKindSchema,
} from "@/contracts/schemas"
import type { z } from "zod"

/** Inferred from Zod so wire schemas and domain types cannot drift. */
export type RoomRole = z.infer<typeof roomRoleSchema>
export type LoopMode = z.infer<typeof loopModeSchema>
export type DefaultJoinRole = z.infer<typeof defaultJoinRoleSchema>
export type SessionKind = z.infer<typeof sessionKindSchema>
export type SessionCapabilities = z.infer<typeof sessionCapabilitiesSchema>
export type RoomJoinRejectedReason = z.infer<
  typeof roomJoinRejectedReasonSchema
>

export type PlaylistSourceKind = z.infer<typeof playlistSourceKindSchema>
export type PlaybackMode = z.infer<typeof playbackModeSchema>
export type IngestStatus = z.infer<typeof ingestStatusSchema>
export type PlaylistBlockedReason = z.infer<typeof playlistBlockedReasonSchema>
export type PlaylistMediaStreamKind = z.infer<
  typeof playlistMediaStreamKindSchema
>

export type PlaylistMediaStream = z.infer<typeof playlistMediaStreamSchema>
export type PlaylistTextTrack = z.infer<typeof playlistTextTrackSchema>
export type PlaylistItem = z.infer<typeof playlistItemSchema>

export type ViewerMediaItemPreference = z.infer<
  typeof viewerMediaItemPreferenceSchema
>
export type ViewerMediaPreferences = z.infer<
  typeof viewerMediaPreferencesStateSchema
>

export type ParticipantLocalPlayback = z.infer<typeof localPlaybackSchema>
export type ParticipantState = z.infer<typeof participantStateSchema>

export type PlaybackState = z.infer<typeof playbackStateSchema>
export type ActionLogEntry = z.infer<typeof actionLogEntrySchema>

/** Client-safe security fields (no password material). */
export type PublicRoomSecurityState = z.infer<typeof publicRoomSecuritySchema>

/** Server/persisted security; includes hash/salt used only server-side. */
export type RoomSecurityState = PublicRoomSecurityState & {
  joinPasswordHash?: string
  joinPasswordSalt?: string
}

/** Snapshot after sanitize: public security only (no joinPasswordHash/Salt). */
export type RoomSnapshotPayload = z.infer<typeof roomSnapshotPayloadSchema>

/**
 * Client-held room state (UI / socket merge). Same as a sanitized snapshot —
 * never includes join password hash/salt.
 */
export type ClientRoomState = RoomSnapshotPayload

/** Server/persisted room state (may include password hash/salt). */
export type RoomState = Omit<RoomSnapshotPayload, "roomSecurity"> & {
  roomSecurity: RoomSecurityState
}

/** One media-playing socket's local playback sample (server-side only). */
export interface LocalPlaybackReport {
  sessionKind: SessionKind
  paused: boolean
  currentTimeMs: number
  loading: boolean
  error?: string
  updatedAt: number
}

/** Wire presence patch fields (S2C / client merge). */
export type PresencePatchWire = z.infer<typeof presencePatchSchema>

/**
 * Per-user fields carried on the coalesced presence channel / Redis.
 * Extends the S2C wire patch with server-only `localPlaybackReports`
 * (stripped before client broadcast — never validated by presencePatchSchema).
 */
export type PresencePatch = PresencePatchWire & {
  /**
   * Per-connection playback samples used to aggregate `localPlayback`.
   * Stored in Redis; stripped before client broadcast.
   */
  localPlaybackReports?: Record<string, LocalPlaybackReport>
}

export type RoomControlPayload = z.infer<typeof roomControlPayloadSchema>
export type PresenceBatchPayload = z.infer<typeof presenceBatchPayloadSchema>
export type AdmissionChangedPayload = z.infer<
  typeof admissionChangedPayloadSchema
>

export interface WsEnvelope<T extends string, P> {
  type: T
  requestId?: string
  sourceUserId?: string
  payload: P
}

export const roomStateTtlSeconds = 3600
/** Ephemeral room action-log max age (matches room Redis TTL). */
export const roomActionLogMaxAgeMs = roomStateTtlSeconds * 1000
export const VIEWER_MEDIA_BY_ITEM_LIMIT = 32
export const MEDIA_STREAM_CATALOG_LIMIT = 12
export const MEDIA_TEXT_TRACK_CATALOG_LIMIT = 20
