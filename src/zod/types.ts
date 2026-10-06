export type RoomRole = "owner" | "moderator" | "guest"
export type LoopMode = "off" | "once" | "always"
export type PlaylistSourceKind = "remote_url" | "local_file"
export type PlaybackMode = "direct" | "relay"
export type IngestStatus = "ready" | "resolving" | "error"
export type PlaylistBlockedReason = "local_owner_offline"
export type SessionKind = "room" | "player" | "control"
export type PlaylistMediaStreamKind = "adaptive" | "combined"

export interface PlaylistMediaStream {
  id: string
  src: string
  type?: string
  protocol?: string
  width?: number
  height?: number
  bitrate?: number
  audioBitrate?: number
  label?: string
  isDefault?: boolean
  kind?: PlaylistMediaStreamKind
  vcodec?: string
  acodec?: string
  audioLanguage?: string
}

export interface PlaylistTextTrack {
  id: string
  src: string
  label: string
  language?: string
  kind?: "captions" | "subtitles" | "chapters" | "descriptions" | "metadata"
  type?: string
  isDefault?: boolean
}

export interface PlaylistItem {
  id: string
  name: string
  sourceKind: PlaylistSourceKind
  playbackMode: PlaybackMode
  sourceUrl: string
  playableUrl: string
  durationSeconds?: number
  ingestStatus?: IngestStatus
  ingestError?: string
  blockedReason?: PlaylistBlockedReason
  mediaStreams?: PlaylistMediaStream[]
  textTracks?: PlaylistTextTrack[]
  /** Resolve-time catalog default (not room-wide viewer selection). */
  defaultStreamId?: string
  /** Resolve-time catalog default caption (not room-wide viewer selection). */
  defaultTextTrackId?: string
  /** @deprecated Migrated to defaultStreamId by repair. */
  selectedStreamId?: string
  /** @deprecated Migrated to defaultTextTrackId by repair. */
  selectedTextTrackId?: string
  /** From yt-dlp when resolve succeeds (live broadcast vs VOD). */
  isLive?: boolean
  localMediaId?: string
  localOriginUserId?: string
  createdBy: string
  createdAt: number
}

export interface ViewerMediaItemPreference {
  streamId?: string
  textTrackId?: string | null
  audioLanguage?: string
}

export interface ViewerMediaPreferences {
  /** Cap enforced server-side (e.g. last 32 item ids). */
  byItemId: Record<string, ViewerMediaItemPreference>
}

export interface ParticipantState {
  userId: string
  username: string
  avatarStyle: string
  role: RoomRole
  connected: boolean
  joinedAt?: number
  connectedAt?: number
  disconnectedAt?: number
  lastSeenAt?: number
  localPlayback: {
    paused: boolean
    currentTimeMs: number
    loading: boolean
    error?: string
    updatedAt: number
  }
  viewerMedia?: ViewerMediaPreferences
}

export interface PlaybackState {
  mediaId?: string
  paused: boolean
  playbackRate: number
  timelineAnchorMs: number
  serverNowMs: number
  videoLoop: LoopMode
  playlistLoop: LoopMode
  shuffle: boolean
  seekPreview?: {
    userId: string
    targetMs: number
    active: boolean
    updatedAt: number
  }
}

export interface ActionLogEntry {
  id: string
  at: number
  roomId: string
  actorUserId: string
  actorUsername?: string
  action: string
  payload: Record<string, unknown>
  error?: string
}

export interface RoomSecurityState {
  joinPasswordEnabled: boolean
  joinPasswordUpdatedAt: number | null
  admissionVersion: number
  joinPasswordHash?: string
  joinPasswordSalt?: string
}

export interface RoomState {
  roomId: string
  ownerId: string
  roomSecurity: RoomSecurityState
  playback: PlaybackState
  playlist: PlaylistItem[]
  currentIndex: number
  participants: Record<string, ParticipantState>
  history: Array<{ mediaId: string; playedAt: number }>
  actionLog: ActionLogEntry[]
  updatedAt: number
  /** Bumps on every persisted room write (control or structural). */
  generation: number
  /** Bumps when playlist / identity / security / logs change (snapshot-worthy). */
  structuralRevision: number
}

/** Per-user fields carried on the coalesced presence channel. */
export interface PresencePatch {
  connected?: boolean
  lastSeenAt?: number
  disconnectedAt?: number
  username?: string
  avatarStyle?: string
  localPlayback?: ParticipantState["localPlayback"]
}

export interface RoomControlPayload {
  generation: number
  playback: PlaybackState
  currentIndex: number
  updatedAt: number
}

export interface PresenceBatchPayload {
  presenceRevision: number
  participants: Record<string, PresencePatch>
  serverNowMs: number
}

export interface RoomSnapshotPayload extends RoomState {
  /** Snapshot omits password hash/salt via sanitize. */
}

export interface WsEnvelope<T extends string, P> {
  type: T
  requestId?: string
  sourceUserId?: string
  payload: P
}

export const roomStateTtlSeconds = 3600
export const VIEWER_MEDIA_BY_ITEM_LIMIT = 32
export const MEDIA_STREAM_CATALOG_LIMIT = 12
export const MEDIA_TEXT_TRACK_CATALOG_LIMIT = 20
