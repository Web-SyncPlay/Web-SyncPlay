const ROOM_PREFIX = "room:"
const ROOM_STATE_SUFFIX = ":state"
const ROOM_CHANNEL_SUFFIX = ":channel"
const ROOM_IDENTITY_SUFFIX = ":identity"
const DEFAULTS_KEY = "defaults:daily-top-10"
const MEDIA_PROXY_PREFIX = "media:proxy:"
const MEDIA_PROXY_BY_URL_PREFIX = "media:proxy:by-url:"
const LOCAL_MEDIA_PREFIX = "media:local:"
const LOCAL_MEDIA_OWNER_INDEX_PREFIX = "media:local:room:"
const CONTROL_TOKEN_PREFIX = "control:token:"

type RoomTypedChannelSuffix = ":control" | ":presence" | ":snapshot" | ":state" | ":channel"

/** Extract roomId from `room:{id}{suffix}`; empty string if the key does not match. */
function parseRoomPrefixedKey(
  key: string,
  suffix: RoomTypedChannelSuffix | typeof ROOM_IDENTITY_SUFFIX,
): string {
  const trimmed = key.trim()
  if (!trimmed.startsWith(ROOM_PREFIX)) {
    return ""
  }
  const withoutPrefix = trimmed.slice(ROOM_PREFIX.length)
  if (!withoutPrefix.endsWith(suffix)) {
    return ""
  }
  return withoutPrefix.slice(0, withoutPrefix.length - suffix.length)
}

export const keys = {
  roomState(roomId: string) {
    return `${ROOM_PREFIX}${roomId}${ROOM_STATE_SUFFIX}`
  },

  /** SCAN MATCH for all room state keys. */
  roomStateScanPattern() {
    return `${ROOM_PREFIX}*${ROOM_STATE_SUFFIX}`
  },

  parseRoomStateKey(key: string): string {
    return parseRoomPrefixedKey(key, ROOM_STATE_SUFFIX)
  },

  roomChannel(roomId: string) {
    return `${ROOM_PREFIX}${roomId}${ROOM_CHANNEL_SUFFIX}`
  },

  roomChannelPattern() {
    return `${ROOM_PREFIX}*${ROOM_CHANNEL_SUFFIX}`
  },

  parseRoomChannel(channel: string): string {
    return parseRoomPrefixedKey(channel, ROOM_CHANNEL_SUFFIX)
  },

  dailyDefaults() {
    return DEFAULTS_KEY
  },

  /**
   * Presence ownership (triple model — do not collapse roles):
   * - `presenceRef` → liveness (WS node-map refcounts; who is online)
   * - `presenceData` HASH → clocks (PresencePatch / localPlayback, etc.)
   * - room JSON `participants.*.connected` → identity/roles only (not source of truth for online)
   *
   * HASH userId → JSON `{ [nodeId]: refcount }` of active WS connections.
   * Legacy plain integer values are ignored (orphaned after process crash).
   */
  roomPresenceRef(roomId: string) {
    return `${ROOM_PREFIX}${roomId}:presenceRef`
  },

  /** Short-lived liveness probe for a realtime process (`getAppNodeId()`). */
  appNodeAlive(nodeId: string) {
    return `app:node:${nodeId}:alive`
  },

  appNodeAliveScanPattern() {
    return "app:node:*:alive"
  },

  /** HASH userId → JSON PresencePatch (clocks; see ownership on `roomPresenceRef`). */
  roomPresenceData(roomId: string) {
    return `${ROOM_PREFIX}${roomId}:presenceData`
  },

  /**
   * Cluster-monotonic presence batch revision (Redis INCR).
   * Published as `presence:batch.presenceRevision` — not process-local.
   */
  roomPresenceSeq(roomId: string) {
    return `${ROOM_PREFIX}${roomId}:presenceSeq`
  },

  roomControlChannel(roomId: string) {
    return `${ROOM_PREFIX}${roomId}:control`
  },

  roomPresenceChannel(roomId: string) {
    return `${ROOM_PREFIX}${roomId}:presence`
  },

  roomSnapshotChannel(roomId: string) {
    return `${ROOM_PREFIX}${roomId}:snapshot`
  },

  roomControlChannelPattern() {
    return `${ROOM_PREFIX}*:control`
  },

  roomPresenceChannelPattern() {
    return `${ROOM_PREFIX}*:presence`
  },

  roomSnapshotChannelPattern() {
    return `${ROOM_PREFIX}*:snapshot`
  },

  /** User-targeted ephemeral (e.g. WebRTC signal) — room:{id}:user:{userId}:ephemeral */
  roomUserEphemeralChannel(roomId: string, userId: string) {
    return `${ROOM_PREFIX}${roomId}:user:${userId}:ephemeral`
  },

  roomUserEphemeralChannelPattern() {
    return `${ROOM_PREFIX}*:user:*:ephemeral`
  },

  parseRoomUserEphemeralChannel(
    channel: string,
  ): { roomId: string; userId: string } | null {
    const trimmed = channel.trim()
    const match = /^room:(.+):user:(.+):ephemeral$/.exec(trimmed)
    if (!match?.[1] || !match[2]) return null
    return { roomId: match[1], userId: match[2] }
  },

  parseRoomTypedChannel(
    channel: string,
    suffix: ":control" | ":presence" | ":snapshot",
  ): string {
    return parseRoomPrefixedKey(channel, suffix)
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
    return `${ROOM_PREFIX}${roomId}:prune:${userId}`
  },

  /** SET of `roomId\\tuserId` pending participant prunes cluster-wide. */
  roomPendingPrunes() {
    return `${ROOM_PREFIX}pending-prunes`
  },

  /** HASH userId -> hashed userSecret for participant identity continuity */
  roomIdentity(roomId: string) {
    return `${ROOM_PREFIX}${roomId}${ROOM_IDENTITY_SUFFIX}`
  },

  /**
   * Per-room viewer capability for public local-media HTTP (finding S4).
   * Value: JSON `{ tokenHash, boundIp }`.
   */
  roomViewerCapability(roomId: string, userId: string) {
    return `${ROOM_PREFIX}${roomId}:viewer:${userId}`
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

  /** Fixed-window / token-bucket rate-limit key (`rate:{logicalKey}`). */
  rateLimit(logicalKey: string) {
    return `rate:${logicalKey}`
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

  /** JSON { nodeId, baseUrl, lastSeen } for multi-replica internal range fetch */
  localMediaNode(nodeId: string) {
    return `${LOCAL_MEDIA_PREFIX}node:${nodeId}`
  },

  /** SCAN MATCH for local-media node registry entries */
  localMediaNodeScanPattern() {
    return `${LOCAL_MEDIA_PREFIX}node:*`
  },

  /** Pub/sub: ask all nodes to reannounce local-media ready for a user */
  localMediaReannounceChannel() {
    return `${LOCAL_MEDIA_PREFIX}reannounce`
  },
} as const
