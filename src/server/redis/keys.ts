const ROOM_STATE_PREFIX = "room:"
const ROOM_STATE_SUFFIX = ":state"
const ROOM_CHANNEL_SUFFIX = ":channel"
const DEFAULTS_KEY = "defaults:daily-top-10"
const MEDIA_PROXY_PREFIX = "media:proxy:"
const MEDIA_PROXY_BY_URL_PREFIX = "media:proxy:by-url:"
const LOCAL_MEDIA_PREFIX = "media:local:"
const LOCAL_MEDIA_OWNER_INDEX_PREFIX = "media:local:room:"
const CONTROL_TOKEN_PREFIX = "control:token:"
const ROOM_IDENTITY_PREFIX = "room:"
const ROOM_IDENTITY_SUFFIX = ":identity"

export const keys = {
  roomState(roomId: string) {
    return `${ROOM_STATE_PREFIX}${roomId}${ROOM_STATE_SUFFIX}`
  },

  roomChannel(roomId: string) {
    return `${ROOM_STATE_PREFIX}${roomId}${ROOM_CHANNEL_SUFFIX}`
  },

  roomChannelPattern() {
    return `${ROOM_STATE_PREFIX}*${ROOM_CHANNEL_SUFFIX}`
  },

  parseRoomChannel(channel: string): string {
    const trimmed = channel.trim()
    if (!trimmed.startsWith(ROOM_STATE_PREFIX)) {
      return ""
    }
    const withoutPrefix = trimmed.slice(ROOM_STATE_PREFIX.length)
    if (!withoutPrefix.endsWith(ROOM_CHANNEL_SUFFIX)) {
      return ""
    }
    return withoutPrefix.slice(
      0,
      withoutPrefix.length - ROOM_CHANNEL_SUFFIX.length,
    )
  },

  dailyDefaults() {
    return DEFAULTS_KEY
  },

  /** HASH userId -> refcount of active WS connections cluster-wide */
  roomPresenceRef(roomId: string) {
    return `${ROOM_STATE_PREFIX}${roomId}:presenceRef`
  },

  /** HASH userId -> JSON PresencePatch (localPlayback clocks, etc.) */
  roomPresenceData(roomId: string) {
    return `${ROOM_STATE_PREFIX}${roomId}:presenceData`
  },

  roomControlChannel(roomId: string) {
    return `${ROOM_STATE_PREFIX}${roomId}:control`
  },

  roomPresenceChannel(roomId: string) {
    return `${ROOM_STATE_PREFIX}${roomId}:presence`
  },

  roomSnapshotChannel(roomId: string) {
    return `${ROOM_STATE_PREFIX}${roomId}:snapshot`
  },

  roomControlChannelPattern() {
    return `${ROOM_STATE_PREFIX}*:control`
  },

  roomPresenceChannelPattern() {
    return `${ROOM_STATE_PREFIX}*:presence`
  },

  roomSnapshotChannelPattern() {
    return `${ROOM_STATE_PREFIX}*:snapshot`
  },

  parseRoomTypedChannel(
    channel: string,
    suffix: ":control" | ":presence" | ":snapshot",
  ): string {
    const trimmed = channel.trim()
    if (!trimmed.startsWith(ROOM_STATE_PREFIX)) {
      return ""
    }
    const withoutPrefix = trimmed.slice(ROOM_STATE_PREFIX.length)
    if (!withoutPrefix.endsWith(suffix)) {
      return ""
    }
    return withoutPrefix.slice(0, withoutPrefix.length - suffix.length)
  },

  mediaYtDlpExtract(urlHash: string) {
    return `media:ytdlp:extract:${urlHash}`
  },

  /** Short-lived SET NX lock so only one instance runs yt-dlp per URL. */
  mediaYtDlpLock(urlHash: string) {
    return `media:ytdlp:lock:${urlHash}`
  },

  /** Heartbeat lease while a playlist item resolve is in progress. */
  mediaYtDlpResolveLease(roomId: string, itemId: string) {
    return `media:ytdlp:resolve-lease:${roomId}:${itemId}`
  },

  /** Per-item pending marker that expires with the resolve lease. */
  mediaYtDlpPending(roomId: string, itemId: string) {
    return `media:ytdlp:pending:${roomId}:${itemId}`
  },

  /** Short NX claim so only one instance reclaims an abandoned resolve. */
  mediaYtDlpResolveClaim(roomId: string, itemId: string) {
    return `media:ytdlp:resolve-claim:${roomId}:${itemId}`
  },

  /** SET of `roomId\\titemId` pending resolves for crash reclaim. */
  mediaYtDlpPendingResolves() {
    return "media:ytdlp:pending-resolves"
  },

  /** Grace-period marker while a disconnected participant awaits prune. */
  roomParticipantPrune(roomId: string, userId: string) {
    return `${ROOM_STATE_PREFIX}${roomId}:prune:${userId}`
  },

  /** SET of `roomId\\tuserId` pending participant prunes cluster-wide. */
  roomPendingPrunes() {
    return `${ROOM_STATE_PREFIX}pending-prunes`
  },

  /** HASH userId -> hashed userSecret for participant identity continuity */
  roomIdentity(roomId: string) {
    return `${ROOM_IDENTITY_PREFIX}${roomId}${ROOM_IDENTITY_SUFFIX}`
  },

  mediaProxyToken(token: string) {
    return `${MEDIA_PROXY_PREFIX}${token}`
  },

  mediaProxyByUrl(urlHash: string) {
    return `${MEDIA_PROXY_BY_URL_PREFIX}${urlHash}`
  },

  controlToken(tokenHash: string) {
    return `${CONTROL_TOKEN_PREFIX}${tokenHash}`
  },

  localMediaEntry(id: string) {
    return `${LOCAL_MEDIA_PREFIX}${id}`
  },

  /** Raw aligned media block bytes shared across instances */
  localMediaBlock(mediaId: string, blockStart: number) {
    return `${LOCAL_MEDIA_PREFIX}block:${mediaId}:${blockStart}`
  },

  /** SET of blockStart values for a media id (for invalidate without SCAN) */
  localMediaBlockIndex(mediaId: string) {
    return `${LOCAL_MEDIA_PREFIX}blocks:${mediaId}`
  },

  /** SET localMediaId for a given room+ownerUserId */
  localMediaOwnerIndex(roomId: string, ownerUserId: string) {
    return `${LOCAL_MEDIA_OWNER_INDEX_PREFIX}${roomId}:owner:${ownerUserId}`
  },

  /** Pub/sub: ask any node that holds the provider socket for a byte range */
  localMediaRelayRequestChannel() {
    return `${LOCAL_MEDIA_PREFIX}relay:request`
  },

  /** LIST: reply bytes for a single relay round-trip */
  localMediaRelayReply(requestId: string) {
    return `${LOCAL_MEDIA_PREFIX}relay:reply:${requestId}`
  },
} as const
